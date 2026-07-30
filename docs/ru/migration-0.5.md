# Миграция `0.4.0` → `0.5.0`

Что изменилось между `0.4.0` и `0.5.0`, что из этого ломается молча и в каком
порядке это чинить. Документ рассчитан на два типа читателя: автора приложения
(`uno.config.ts`) и автора пакета-провайдера.

> 🇬🇧 English version: [`../en/migration-0.5.md`](../en/migration-0.5.md).

Общий принцип релиза: большая часть изменений — это превращение молчаливых
поломок в громкие. Там, где `0.4.0` печатал `console.warn` или отдавал пустой
CSS, `0.5.0` бросает типизированную ошибку с именем провайдера и компонента.
Если сборка после обновления упала — почти наверняка она была сломана и до него.

## Кратко

| Изменение | Кого касается | Действие |
|---|---|---|
| `layer` по умолчанию — `'granular'`, порядок `-50` | приложения | проверить каскад, при необходимости `layer: null` |
| `scan.extensions` дополняет дефолтный список | приложения | `replaceExtensions: true`, если нужен старый смысл |
| Валидация провайдера на регистрации | провайдеры | `packageBaseUrl` обязан заканчиваться на `/` |
| `resolveComponentScanDirs` → `{ dirs, skipped }` | инструменты | `.dirs` на месте старого массива |
| Вложенные CSS-блоки в токенах — ошибка | провайдеры | сделать блоки плоскими |
| `tokenDefinitionsRef` | провайдеры | убрать `config.node.ts` и импорт `/node` |
| Точка входа `./runtime` + `granularThemesPlugin` | приложения | переключение тем без рукописной карты |
| `themes.define` | приложения | собственные темы приложения |
| Команды CLI `explain` / `why-css` | все | отладка вместо чтения CSS глазами |

## Ломающие изменения

### 1. Слой по умолчанию — `granular`

`layer?: string` стал `layer?: string | null`. `undefined` больше не означает
«без слоя»: пресет кладёт всё, что эмитит, в слой `granular` и **сам объявляет
его порядок** — `-50`, то есть после `preflights` и до `shortcuts`/`default`.

Так компонентный CSS перебивается утилитой (`p-5`), а не наоборот. В `0.4.0`
приложение, не задавшее слой, получало preflight'ы вне слоёв, а при задании
слоя без `layers` в `defineConfig` — порядок `0`, ничью с `default` и разбор
по алфавиту, то есть `granular` уезжал ПОСЛЕ утилит.

```ts
// вернуть поведение «без слоя вовсе»
presetGranularNode({ providers, components: 'all', layer: null })
```

Приложения из `apps/app-1..4` уже передавали `layer: 'granular'` явно — для них
меняется только объявленный порядок.

### 2. `scan.extensions` теперь ДОПОЛНЯЕТ, а не заменяет

`extensions: ['mdx']` в `0.4.0` означало «сканировать только `.mdx`» и молча
выключало скан `.vue`/`.js`. Теперь это «дефолтные расширения плюс `.mdx`».

```ts
// старый смысл (полная замена списка)
scan: { extensions: ['mdx'], replaceExtensions: true }
```

Дефолтный список — `js`, `mjs`, `cjs`, `ts`, `mts`, `cts`, `jsx`, `tsx`, `vue`;
итоговый считается хелпером `resolveScanExtensions()` из `/node`.

### 3. Провайдер валидируется при регистрации

`expandProviders` теперь бросает `InvalidProviderError` (`reason`:
`invalid-id`, `invalid-package-base-url`, `package-base-url-not-a-directory`,
`invalid-components`, `css-files-length-mismatch`).

Самый частый случай — `packageBaseUrl` без завершающего `/`: `new URL()`
отбрасывает последний сегмент, и скан уезжал на уровень выше. В `0.4.0` это
проявлялось как пустой CSS, сейчас — как ошибка на загрузке конфига.

### 4. `resolveComponentScanDirs` возвращает объект

Было `ResolvedScanDir[]`, стало `ScanDirsInspection` — `{ dirs, skipped }`.
`skipped` перечисляет компоненты, выпавшие из скана, с причиной
(`missing-dir`, `missing-entry`, `invalid-base-url`).

Прямые потребители функции (свои скрипты, обёртки) добавляют `.dirs`. В
приложениях функция обычно не вызывается напрямую — там `granularContent`.

### 5. Парсер CSS-токенов: только плоские блоки

`tokenDefinitionsFromCss*` и `parseCssCustomPropertyBlocks*` разбирают CSS
рекурсивно и больше не притворяются, что вложенный блок — это блок верхнего
уровня. Вложенность (CSS Nesting) и блоки внутри `@media`/`@supports` попадают
в «пропущенные»: в строгом режиме — ошибка, иначе — один `warn`.

```css
/* было в 0.4.0 — «работало» случайно */
.dark { :root { --x: yellow; } }

/* стало */
.dark { --x: yellow; }
```

Заодно поправлено: точка с запятой у последнего объявления в блоке теперь
необязательна.

### 6. `presetGranularNode` всегда отдаёт `content`

Раньше при пустых globs (`scan.enabled: false`) секция `content` пресета
подменялась базовой и терялся `pipeline.include` — без него extractor не
заглядывал в `.js` внутри компонентных директорий. Теперь `content` отдаётся
всегда. Если вы обходили это своим `content` в `defineConfig`, обходной путь
можно снять.

### 7. Ошибки чтения CSS теперь именованные

Вместо голого `ENOENT` с абсолютным путём — `GranularCssReadError` с
провайдером, секцией (`base/tokens` / `theme` / `component`) и субъектом.
Ловите по классу, если у вас была обработка по строке сообщения.

### 8. Публикация: `dist/package.json` больше не генерируется

Пакет публикуется из корня каталога (`files: ["dist"]`), вложенный манифест с
собственной картой `exports` вводил бандлеры в заблуждение. Импорты по
документированным точкам входа не затронуты; глубокие импорты вида
`@feugene/unocss-preset-granular/dist/...` — не поддерживались и раньше.

### 9. Лицензия и окружение

Лицензия — `MIT` (был `SEE LICENSE IN LICENSE`), в репозитории появились файлы
`LICENSE`. `typescript` в devDependencies — `^6.0.3`.

## Что нового

### `tokenDefinitionsRef` — токены темы ссылкой на CSS

Главная причина обновиться автору провайдера. Раньше, чтобы отдать структурные
токены, компонент звал `tokenDefinitionsFromCssSync` из `/node` — а этот импорт,
попав в браузерный `config.ts`, тащил `node:fs` в клиентский бандл (сборка при
этом не падала). Приходилось держать парный `config.node.ts`.

Теперь ссылка — это данные, а файл читает node-слой пресета:

```ts
export const xTokenizedConfig = defineGranularComponent(import.meta.url, {
  name: 'XTokenized',
  tokenDefinitionsRef: {
    light: new URL('./themes/light.css', import.meta.url).href,
    dark: { url: new URL('./themes/dark.css', import.meta.url).href, as: '.dark, [data-theme="dark"]' },
  },
})
```

Поля `GranularThemeTokenRef`: `url`, `selector` (что забрать, по умолчанию
`:root`), `as` (под чем эмитить), `strict` (по умолчанию `true`), `assetName`
(fallback для опубликованного `dist` без исходников — проставляется хелперами).
То же поле есть у провайдера целиком (`theme.tokenDefinitionsRef`). Литеральные
`tokenDefinitions` для той же темы имеют приоритет над ссылкой.

После перехода `granular-provider/node.ts` обычно вырождается в
`export * from './index'` — см. [Написание провайдеров](./authoring-providers.md).

### `resolvePackageBaseUrl`

Замена рукописного слайса `import.meta.url` в каждом провайдере:

```ts
import { resolvePackageBaseUrl } from '@feugene/unocss-preset-granular/contract'

export const PACKAGE_BASE_URL = resolvePackageBaseUrl(import.meta.url)
```

Второй аргумент `levelsUp` (по умолчанию `1`) — сколько уровней подняться от
модуля до корня раскладки. Литеральный `new URL('..', import.meta.url)` для
этого не годится: Vite и rolldown распознают именно этот литерал и заменяют его
на `data:`-URL, после чего скан-директории схлопываются в ничто.

### `granularAssetFileNames` в `/vite`

Парный хелпер к `granularChunkFileNames`: кладёт CSS компонента туда, где его
ждёт контракт — `components/<Name>/styles.css`. По умолчанию Vite положил бы его
плоско (`dist/XTest1.css`), и fallback чтения CSS в опубликованном пакете
упирался в `ENOENT`.

```ts
export default defineConfig({
  build: {
    rolldownOptions: {
      output: {
        chunkFileNames: granularChunkFileNames(),
        assetFileNames: granularAssetFileNames({ components: COMPONENT_NAMES }),
      },
    },
  },
})
```

### Темы приложения: `themes.define`

Набор тем принадлежит приложению, а не провайдерам. `themes.define` позволяет
объявить свои темы (`extends` от эффективных токенов чужой темы, собственные
`tokens`/`tokensRef`, `label`, `colorScheme`) и не подключать ни `light`, ни
`dark`, даже если провайдер их поставляет.

```ts
themes: {
  define: {
    emerald: { extends: 'light', tokens: { 'app-bg': '#052e1f' }, label: 'Изумруд', colorScheme: 'dark' },
  },
}
```

Важно: `define` без `names` означает «список тем сборки = ключи `define`»;
`defaultThemes` провайдеров в этом случае не смотрятся. Приоритет токенов:
провайдеры → компоненты → `define` → `tokenOverrides`. Подробности — в
[Темах и токенах](./themes-and-tokens.md).

### Рантайм-переключение тем: `./runtime` + `granularThemesPlugin`

Пятая точка входа `./runtime` — только типы, парсер селекторов и контроллер над
DOM: ни FS, ни UnoCSS, ни зависимостей. Пара к ней — Vite-плагин из `/node`,
отдающий манифест `virtual:granular-themes` из ТОЙ ЖЕ резолюции, из которой
эмитится CSS, поэтому разъехаться они не могут.

```ts
// vite.config.ts
plugins: [vue(), UnoCSS({ configFile }), granularThemesPlugin(granularOptions)]

// src/theme.ts
import manifest from 'virtual:granular-themes'
import { createThemeController } from '@feugene/unocss-preset-granular/runtime'

export const themes = createThemeController(manifest)
```

У контроллера — `list()`, `get()`, `set()`, `cycle()`, `subscribe()`, `entry()`;
опции: `target`, `storage` (по умолчанию `localStorage`, `null` — не помнить),
`storageKey`, `initial` (`'auto'` — сохранённый выбор, иначе системная схема),
`systemThemes`, `prefersDark`. Живые примеры — `apps/app-5` (темы провайдера) и
`apps/app-6` (темы приложения).

### CLI: `explain`, `why-css`, `--json`, `--strict`

`granular` больше не только `doctor`:

```bash
granular doctor  ./granular.options.mjs --json --strict
granular explain ./granular.options.mjs '@feugene/simple-package:XTokenized'
granular why-css ./granular.options.mjs 'rounded-3xl'
```

`explain` показывает, почему компонент в сборке (цепочка от корня селекции,
обратные зависимости, вклад в safelist/CSS/токены), `why-css` — какой компонент
притащил класс в итоговый CSS. Флаги разбираются в любой позиции. Программный
доступ — `granularExplain`/`granularWhyCss` и `format*Report` из `/node`.
Полный справочник — [CLI `granular`](./cli.md).

### Диагностика вместо тишины

`doctor` получил структурированные `diagnostics` (`level`, `code`), поля `ok`
(нет `error`) и `clean` (нет вообще ничего, это и проверяет `--strict`), а
резолвер тем — `warnings`: `default-theme-without-source`, `partial-theme`,
`multiple-default-themes`, `theme-extends-unresolved`, `theme-extends-cycle`.
Скан-директории теперь считаются один раз и одинаково для сборки и для doctor —
раньше doctor показывал не тот набор, который уходил в сборку.

## План миграции

Для приложения:

1. Поднять `@feugene/unocss-preset-granular` до `^0.5.0`, пересобрать
   провайдеры (`yarn build:all` — порядок сборки часть контракта).
2. Проверить каскад: слой `granular` теперь объявлен с порядком `-50`.
   Свой порядок задаётся `layers` в `defineConfig`, отказ от слоя — `layer: null`.
3. Если задавали `scan.extensions` — решить, дополнение это или замена.
4. Прогнать `granular doctor ./granular.options.mjs --strict` и разобрать
   предупреждения: почти все из них описывают дефекты, которые были и в `0.4.0`.
5. По желанию — перевести переключатель тем на `./runtime`.

Для провайдера:

1. Заменить рукописный `packageBaseUrl` на `resolvePackageBaseUrl(import.meta.url)`
   и убедиться, что значение заканчивается на `/`.
2. Перевести `tokenDefinitions` на `tokenDefinitionsRef` и удалить импорты из
   `/node` в браузерных `config.ts` (и парные `config.node.ts`).
3. Сделать CSS-блоки токенов плоскими — вложенность больше не разбирается.
4. Добавить `assetFileNames: granularAssetFileNames({ components })` в
   `vite.config.ts`.
5. Проверить `cssFiles` и `cssFileAssetNames` на равную длину — теперь это
   ошибка, а не молча отключённый fallback.

## Проверка

```bash
yarn build:all
yarn test:all
```

`test:all` — это тесты пресета, проверка зеркальности документации, сборка всех
пакетов и приложений и `verify:apps`: сверка собранного CSS с `expected-css.mjs`
каждого приложения. Успешная сборка сама по себе не доказывает ничего — она
остаётся зелёной и тогда, когда классы компонента молча исчезли из CSS. Если
что-то разъехалось — начните с [Рецептов и отладки](./troubleshooting.md).
