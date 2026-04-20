# Архитектура

> См. также: [Сканирование компонентов](./component-scanning.md),
> [Темы и токены](./themes-and-tokens.md).

Описание устройства пресета — чтобы можно было предсказывать поведение,
отлаживать и расширять.

## Две точки входа

| Entry                                       | Когда использовать                          | Побочные эффекты |
|---------------------------------------------|---------------------------------------------|------------------|
| `@feugene/unocss-preset-granular`           | Браузер / runtime (без `fs`)                | нет              |
| `@feugene/unocss-preset-granular/node`      | Build‑time (Vite, CLI, тесты)               | читает файлы     |
| `@feugene/unocss-preset-granular/contract`  | Авторам провайдеров — типы + `define*`      | нет (типы)       |

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

1. **Валидация провайдеров** — уникальность `id`, поддержка
   `contractVersion`, отсутствие дубликатов имён компонентов внутри
   провайдера.
2. **Expand providers** — `expandProviders(options.providers)`
   разворачивает смесь объектов, фабрик и массивов в канонический список.
3. **Реестр компонентов** — карта `providerId:Name → descriptor` по всем
   провайдерам. Cross‑provider `dependencies` резолвятся против этого
   реестра.
4. **Selection** — из `options.components` (`'all'` или список селекторов)
   вычисляется набор выбранных компонентов.
5. **Транзитивные зависимости** — BFS по `descriptor.dependencies` с
   детекцией циклов (`CircularDependencyError` /
   `CircularProviderDependencyError`).
6. **Resolution тем** — пересечение `options.themes.names` с тем, что
   каждый провайдер объявил в `theme.themes`; fallback на `defaultThemes`.
7. **Emit `safelist`** — объединение `descriptor.safelist` всех
   резолвнутых компонентов.
8. **Emit preflights** — для node entry: читать `base.css`, `tokens.css`,
   все выбранные темы и `cssFiles` каждого резолвнутого компонента;
   конкатенированный результат — один UnoCSS preflight.
9. **Emit `rules` / `variants` / кастомные preflights** — из
   `provider.unocss.*` всех *использованных* провайдеров (если не
   `includeProviderUnocss: false`).
10. **Emit `content.filesystem`** — только node entry; потребляется через
    `granularContent(options)`.

При ошибке (неизвестный компонент, cross‑provider ссылка на
незарегистрированного провайдера, отсутствующий CSS в strict‑режиме) —
типизированная ошибка — см.
[`src/core/errors.ts`](../../packages/unocss-preset-granular/src/core/errors.ts).

## Layers

Всё, что эмитит пресет, попадает в один конфигурируемый `layer` (по
умолчанию — `granular`). Layer прозрачен для потребителя и отвечает
только за порядок относительно других UnoCSS‑layer'ов:

```ts
// Типичный порядок layer'ов в приложении, сверху вниз:
// preflights > granular > utilities > shortcuts
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

**`src/` ↔ `dist/` fallback** применяется к `cssFiles`: при чтении файла,
если основной путь не существует, node‑слой пробует соседний `src/` /
`dist/`. Это позволяет одному и тому же коду провайдера работать и в
монорепо‑dev (исходники), и в опубликованном пакете (только `dist/`).

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
- `@feugene/unocss-preset-granular/node`
  - `presetGranularNode(options)` — node factory.
  - `granularContent(options)` — обязательный content‑хелпер.
  - `resolveGranularFilesystemGlobs(options)` — low‑level доступ к globs.
  - `tokenDefinitionsFromCss[Sync]`,
    `parseCssCustomPropertyBlocks[Sync]`.
- `@feugene/unocss-preset-granular/contract`
  - Типовая поверхность для авторов провайдеров:
    `GranularProvider`, `GranularComponentDescriptor`, `defineGranular*`.
