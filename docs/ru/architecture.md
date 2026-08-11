# Архитектура

> См. также: [Сканирование компонентов](./component-scanning.md),
> [Темы и токены](./themes-and-tokens.md).

Описание устройства пресета — чтобы можно было предсказывать поведение,
отлаживать и расширять.

## Шесть точек входа

| Entry                                       | Когда использовать                          | Побочные эффекты |
|---------------------------------------------|---------------------------------------------|------------------|
| `@feugene/unocss-preset-granular`           | Браузер / runtime (без `fs`)                | нет              |
| `@feugene/unocss-preset-granular/node`      | Build‑time (Vite, CLI, тесты)               | читает файлы     |
| `@feugene/unocss-preset-granular/contract`  | Авторам провайдеров — типы + `define*`      | нет (типы)       |
| `@feugene/unocss-preset-granular/vite`      | Vite‑сборке **провайдера** — `granularChunkFileNames`, `granularAssetFileNames` | нет (чистые функции) |
| `@feugene/unocss-preset-granular/runtime`   | Браузеру — переключение тем в рантайме       | нет (только DOM)     |
| `@feugene/unocss-preset-granular/codegen`   | Собственной оснастке **провайдера** — генерация его реестров компонентов | читает и пишет файлы |

Entry `/vite` — часть контракта сканирования, а не опциональное удобство: без
`granularChunkFileNames` в `build.rollupOptions` провайдера SFC‑чанки лягут
вне директории компонента и не попадут в скан — см.
[Сканирование компонентов](./component-scanning.md).

Браузерный entry (`presetGranular`) возвращает чистый JS‑пресет:
`rules` / `variants` / `safelist` / `preflights` (только inline). Node
entry (`presetGranularNode`) надстраивает и добавляет:

1. **CSS‑preflights с диска** — base / tokens / themes / component `cssFiles`
   читаются на этапе конфига и встраиваются как preflights (по одному на
   layer).
2. **Вычисление `content.filesystem`** — строится транзитивный граф
   компонентов и превращается в scan globs (пробрасываются в приложение
   через хелпер `granularContent(options)`).
3. **`tokenDefinitionsFromCss*` хелперы** — используются node entry
   провайдера, когда он хочет отдать структурные токены (см.
   [Темы и токены](./themes-and-tokens.md)).

## Пайплайн резолвинга

При вызове `presetGranular*(options)` ядро делает (по порядку):

1. **Материализация `tokenDefinitionsRef`** (только node entry) — ссылки на
   CSS-файлы, объявленные провайдерами и компонентами, читаются и превращаются
   в обычные `tokenDefinitions`; ниже по течению ссылок уже не существует.
   Результат — производный объект опций, мемоизированный по идентичности
   исходного.
2. **Expand providers** — `expandProviders(options.providers)` обходит
   `provider.dependencies` и разворачивает граф в дедуплицированный,
   топологически упорядоченный список провайдеров. Дубликат `id` от двух
   РАЗНЫХ инстансов → `DuplicateProviderIdError`; цикл в зависимостях
   провайдеров → `CircularProviderDependencyError`; `contractVersion`, отличная
   от поддерживаемой (`GRANULAR_CONTRACT_VERSION`), →
   `UnsupportedContractVersionError`.
3. **Реестр компонентов** — карта `providerId:Name → descriptor` по всем
   провайдерам. Cross‑provider `dependencies` резолвятся против этого
   реестра. Два компонента с одинаковым именем **внутри одного провайдера** →
   `DuplicateComponentNameError` (fail-fast, это баг публикации).
4. **Selection** — из `options.components` (`'all'` или список селекторов)
   вычисляется набор выбранных компонентов.
5. **Транзитивные зависимости** — DFS (post‑order) по
   `descriptor.dependencies` с детекцией циклов (`CircularDependencyError` /
   `CircularProviderDependencyError`); зависимости идут раньше зависящих.
6. **Resolution тем** — имена берутся из `options.themes.names`, а если он
   опущен — из объединения `theme.defaultThemes` всех провайдеров (фолбэк
   `['light']`); затем пересекаются с тем, что каждый провайдер объявил в
   `theme.themes`/`tokenDefinitions`.
   Наборы токенов группируются **по селектору** в
   `tokenRegistry[theme].blocks`, поэтому разные источники могут добавлять в
   одну тему отдельные блоки селекторов.
7. **Emit `safelist`** — объединение `descriptor.safelist` всех
   резолвнутых компонентов.
8. **Emit preflights** — для node entry: читать `base.css`, `tokens.css`,
   все выбранные темы и `cssFiles` каждого резолвнутого компонента;
   конкатенированный результат — один UnoCSS preflight.
9. **Emit `rules` / `variants` / кастомные preflights** — из
   `provider.unocss.*` **всех провайдеров развёрнутого графа** —
   `options.providers` плюс их транзитивные `dependencies`, независимо от
   того, попал ли хоть один их компонент в селекцию (если не
   `includeProviderUnocss: false`). Так же ведут себя секции base/tokens/тем:
   они инлайнятся от того же полного списка.
10. **Emit `content.filesystem`** — только node entry; потребляется через
   `granularContent(options)`.

Вся резолюция выше (`resolvePresetGranular`) **мемоизируется по идентичности
объекта `options`**, поэтому `presetGranularNode(options)` и
`granularContent(options)` с одним и тем же объектом считают граф один раз.

При ошибке резолвинга (неизвестный компонент, cross‑provider ссылка на
незарегистрированного провайдера, дубль id, цикл зависимостей,
неподдерживаемая `contractVersion`, некорректный провайдер) — типизированная
ошибка, см.
[`src/core/errors.ts`](../../packages/unocss-preset-granular/src/core/errors.ts).

Форма провайдера проверяется **при регистрации** (`expandProviders`), а не
тогда, когда об неё спотыкается FS: пустой `id`, `packageBaseUrl` не-URL или
без завершающего `/`, рассинхрон длин `cssFiles`/`cssFileAssetNames` — всё это
даёт `InvalidProviderError`.

Чтение CSS бросает `GranularCssReadError` с указанием провайдера, секции
(base/tokens, тема, компонент) и имени темы/компонента; исходный `ENOENT`
сохраняется в `cause`. Режима строгости для чтения CSS нет — `scan.strict`
отвечает только за layout‑контракт директорий (см. ниже).

## Layers

Всё, что эмитит пресет, попадает в один слой — по умолчанию **`granular`**.
Это касается и FS/inline‑preflight'ов, и `unocss.rules` провайдеров: UnoCSS
проставляет слой пресета и на его правила.

Пресет также **объявляет порядок** этого слоя (`-50`) — между собственными
слоями UnoCSS `preflights` (`-100`) и `shortcuts` (`-10`) / `default` (`0`):

```
imports (-200) → preflights (-100) → granular (-50) → shortcuts (-10) → utilities (0)
```

Порядок здесь и есть смысл: утилита (`p-5`) должна перебивать базовый стиль
компонента, а не наоборот. Объявление порядка для этого **обязательно** —
неизвестному имени слоя UnoCSS даёт порядок `0`, то есть тот же бакет, что у
`default`, ничья ломается по алфавиту, и `granular` оказался бы *после* утилит,
молча их перебивая.

Два способа отступить от дефолта:

- `layer: 'my-name'` — то же поведение под другим именем (порядок объявляется
  для того имени, которое вы передали);
- `layer: null` — слоя нет вовсе: preflight'ы уходят в штатный `preflights`
  UnoCSS, правила провайдеров — в `default`.

Последнее слово всегда за приложением — его `layers` в `defineConfig`
мержится после пресетов:

```ts
defineConfig({
  presets: [presetGranularNode(opts)],
  layers: { granular: 50 }, // отправить granular после утилит
})
```

Per‑component / per‑theme preflights тегируются тем же layer'ом (если
провайдер явно не переопределяет), чтобы порядок был стабильным.

## Файловые конвенции

Node entry ожидает такую раскладку (относительно `packageBaseUrl`):

```
<packageBaseUrl>/
├─ components/<Name>/...        ← scan dir + опц. styles.css
├─ styles/base.css               ← опц. baseCssUrl
├─ styles/tokens.css             ← опц. tokensCssUrl
└─ styles/themes/<name>.css      ← опц. themes[<name>]
```

— но **ни один путь не зашит**: все они явно заданы в
`defineGranularProvider(...)` и могут указывать куда угодно внутри пакета.

**Fallback для `cssFiles`** устроен так (`src/fs/readCss.ts`,
`resolveComponentCssFile`): node‑слой сначала пробует URL из
`descriptor.cssFiles[i]`. Если файла нет — берёт соответствующий
`descriptor.cssFileAssetNames[i]` и резолвит его **относительно
`packageBaseUrl`** провайдера, то есть `<packageBaseUrl>/<assetName>`. Для
компонентов, объявленных через `defineGranularComponent`, это имя генерируется
как `components/<Name>/<file>`. Ни
`src/`, ни `dist/` в этой логике не участвуют; механизм работает и там, и там
лишь потому, что провайдер указывает `packageBaseUrl` на корень своего
пакета, а он различается в исходниках и в собранном виде.

Два следствия:

- массивы сопоставляются **по позиции**, поэтому рассинхрон длин молча
  отключает fallback для «хвоста»;
- если fallback‑путь тоже не существует, чтение падает с
  `GranularCssReadError`, где названы провайдер и компонент (сырой `ENOENT`
  остаётся в `cause`).

## Почему `content` — на стороне user‑конфига, а не пресета

Технически UnoCSS‑пресет *может* возвращать `content.filesystem`, но
`@unocss/vite` читает `content.*` только из top‑level user‑конфига — то,
что возвращает пресет в поле `content`, сканер и watcher плагина
игнорируют. Это свойство архитектуры UnoCSS, а не баг пресета. Мостиком
служит чистый хелпер `granularContent(options)`, который приложение
единожды вызывает в `uno.config.ts`. Вход тот же, что у
`presetGranular*`, — синхронность гарантирована.

## Публичные экспорты (шпаргалка)

- `@feugene/unocss-preset-granular`
  - `presetGranular(options)` — браузерная factory.
  - `defineGranularComponent`, `defineGranularProvider` и типы из
    `./contract`.
  - `expandProviders`, `ComponentSelection`, `ResolvedThemeItem`,
    `CircularDependencyError` и т.д.
- `@feugene/unocss-preset-granular/node` — **надмножество** корневого entry
  (реэкспортит всё из `.` плюс node‑хелперы ниже), поэтому конфигу приложения
  достаточно одного этого импорта.
  - `defineGranular(options)` — рекомендуемый единый билдер; возвращает
    `{ preset(), content(), resolution(), nodeCss() }` на одной мемоизированной
    резолюции (`preset()` и `content()` автоматически согласованы).
  - `presetGranularNode(options)` — node factory.
  - `granularContent(options)` — обязательный content‑хелпер (если не
    используете `defineGranular`).
  - `resolveGranularFilesystemGlobs(options)` — low‑level доступ к globs.
  - `getGranularThemeCss` / `getGranularComponentCss` — срезы «только темы» и
    «только компоненты» (их конкатенация равна `getGranularNodeCss`).
  - `granularDoctor(options)` / `formatDoctorReport(report)` — диагностика
    (та же, что CLI `granular doctor`).
  - `tokenDefinitionsFromCss[Sync]`,
    `parseCssCustomPropertyBlocks[Sync]`.
  - `clearCssCache()` / `getCssCacheSize()` — кэш чтения CSS инвалидируется
    пофайлово по `(mtime, size)` и ограничен сверху `CSS_CACHE_MAX_ENTRIES`
    (LRU), поэтому в долгом dev‑сервере он не растёт бесконечно; явный сброс
    оставлен для инструментов.
  - `inspectGranularScanDirs(options)` — что реально уходит в скан (`dirs`)
    и что отсеяно layout‑контрактом (`skipped`); единый мемоизированный обход
    FS, общий с `granularContent` и doctor'ом.
- `@feugene/unocss-preset-granular/contract`
  - Поверхность для авторов провайдеров: `GranularProvider`,
    `GranularComponentDescriptor`, `defineGranular*` и
    `resolvePackageBaseUrl(importMetaUrl, levelsUp?)`.
  - `getGranularThemeManifest(options, ?)` / `granularThemesPlugin(options, ?)`
    — манифест тем для рантайм‑слоя (`virtual:granular-themes`).
  - `resolveGranularNode(options)` — резолюция, которой обязаны пользоваться
    все node‑потребители: то же, что `resolvePresetGranular`, но поверх опций
    с развёрнутыми `tokenDefinitionsRef`.
- `@feugene/unocss-preset-granular/vite`
  - `granularChunkFileNames(options?)` — SFC‑чанки в
    `components/<Name>/chunks/`.
  - `granularAssetFileNames(options?)` — CSS компонента в
    `components/<Name>/styles.css`.
- `@feugene/unocss-preset-granular/runtime`
  - `createThemeController(manifest, options?)` — переключение тем в рантайме
    поверх блоков токенов, уже лежащих в CSS.
  - `resolveThemeActivation(selectors)` — чистый парсер «селектор → операция
    над DOM», на котором он построен.
