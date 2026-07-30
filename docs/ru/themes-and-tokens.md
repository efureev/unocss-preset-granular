# Темы и токены

> См. также: [Использование в приложениях](./usage-in-apps.md),
> [Написание провайдеров](./authoring-providers.md).

Модель тем — слоями:

1. **`baseCssUrl`** — необязательный package‑wide base (normalize, resets,
   defaults для `body`). По одному на провайдера.
2. **`tokensCssUrl`** — необязательный CSS с **декларациями** токенов,
   не зависящих от семантики (`--font-sans`, `--radius-md`).
3. **`themes[themeName]`** — per‑theme CSS (`light.css`, `dark.css`);
   приложение выбирает по имени.
4. **`provider.theme.tokenDefinitions`** (только node, опц.) — структурные токены,
   распарсенные из темы на уровне пакета; включают `tokenOverrides` /
   `strictTokens` без дубляжа значений.
5. **`component.tokenDefinitions`** (опц., см. [component-authoring.md](./component-authoring.md#7-токены-темы-на-уровне-компонента-tokendefinitions)) —
   поаналогичное объявление, но точечно для выбранного компонента.
   Мёржится поверх провайдерского слоя в порядке `resolveSelection`
   (post‑order DFS), выгружается только для активных тем (пересечение с
   `themes.names`).
6. **`themes.define`** (app, опц.) — темы, объявленные **приложением**:
   собственная палитра, наследование чужой темы через `extends`, свой
   селектор и метаданные для переключателя. См.
   [Собственные темы приложения](#собственные-темы-приложения-themesdefine).
7. **`themes.tokenOverrides`** (app, опц.) — финальные переопределения
   на стороне приложения. **Высший приоритет** — перебивают любые значения
   от провайдеров/компонентов и могут добавлять новые токены.

Темы — плоский `Record<themeName, cssUrl>` у провайдера; приложение
перечисляет нужные имена:

```ts
presetGranularNode({
  providers: [...],
  components: [...],
  themes: { names: ['light', 'dark'] },
})
```

Имена тем — **произвольные строки**. `light`/`dark` не зашиты в ядро: это
всего лишь имена, которые традиционно выбирают провайдеры.

Откуда берётся итоговый список, в порядке убывания приоритета:

1. `themes.names`, если задан явно;
2. ключи `themes.define`, если приложение объявило свои темы;
3. объединение `theme.defaultThemes` всех провайдеров (включая транзитивных
   доноров) в порядке провайдеров, с дедупом;
4. фолбэк ядра — одна тема `light`.

`themes: { names: [] }` по-прежнему означает *тем нет вовсе* — это не то же
самое, что опустить `themes`.

`npx granular doctor` показывает, какие имена выбраны и откуда, а также
предупреждает: тема объявлена в `defaultThemes`, но провайдер её не
поставляет; тему покрывают не все провайдеры; по умолчанию активировано
больше одной темы (их блоки эмитятся одновременно, при пересечении
селекторов победит последняя).

## Сторона провайдера

```ts
// granular-provider/index.ts
export default defineGranularProvider({
  // ...
  theme: {
    baseCssUrl:   new URL('../styles/base.css',   import.meta.url).href,
    tokensCssUrl: new URL('../styles/tokens.css', import.meta.url).href,
    themes: {
      light: new URL('../styles/themes/light.css', import.meta.url).href,
      dark:  new URL('../styles/themes/dark.css',  import.meta.url).href,
    },
    defaultThemes: ['light'],
  },
})
```

## Слой компонента: `component.tokenDefinitions`

Любой компонент в `defineGranularComponent(...)` может публиковать свои
CSS‑токены для тем — не загрязняя общий набор токенов донор‑пакета.

```ts
// src/components/XTokenized/config.ts
defineGranularComponent(import.meta.url, {
  name: 'XTokenized',
  tokenDefinitions: {
    // NB: ключи токенов пишутся БЕЗ префикса `--` — его дописывает генератор.
    light: { selector: ':root', tokens: { 'x-tokenized': '#2563eb' } },
    dark:  { selector: '.dark', tokens: { 'x-tokenized': '#93c5fd' } },
  },
})
```

Пресет обходит выбранные компоненты в порядке `resolveSelection` (post‑order DFS)
и мёржит их `tokenDefinitions` поверх провайдерского слоя. **В итоговый CSS
попадают только активные темы** (те, что перечислены в `themes.names`).
Компонент может также **создать тему с нуля**, если её не объявлял ни один
провайдер (у аппа в `themes.names` есть, у провайдера нет — компонент
даёт для неё блок).

Полный список use‑case'ов (single‑theme фильтрация, multi‑theme, override
провайдерского токена, поведение в `strictTokens`) см. в
[component-authoring.md §7](./component-authoring.md#7-токены-темы-на-уровне-компонента-tokendefinitions).

## Мультиселекторные темы

Тема **не** ограничена одним селектором. Наборы токенов группируются по
`selector` в `tokenRegistry[theme].blocks`, поэтому разные провайдеры/компоненты
могут добавлять в одну тему свои блоки. Например, один провайдер эмитит `dark`
под `.dark`, другой — под `[data-theme="dark"]`; эмитятся оба блока:

```css
.dark { --a: 1; }
[data-theme="dark"] { --b: 2; }
```

Набор токенов **без** `selector` мержится в **первичный** (первый) блок темы, а
не плодит отдельный `:root`.

## Собственные темы приложения: `themes.define`

**Набор тем принадлежит приложению**, а не провайдерам. Провайдер поставляет
значения, из которых тему можно собрать; какие темы существуют в сборке —
решает приложение. Приложению может быть нужна ровно одна тема, или три
собственных, или три собственных плюс провайдерская `dark`.

```ts
presetGranularNode({
  providers: [dsProvider],          // поставляет light и dark
  components: [...],
  themes: {
    define: {
      emerald: {
        extends: 'light',           // взять эффективные токены light за основу
        tokens: { 'app-bg': '#052e1f', 'app-accent': '#10b981' },
        label: 'Изумруд',
        colorScheme: 'dark',
      },
      ocean: {
        extends: 'light',
        tokens: { 'app-bg': '#e0f2fe', 'app-accent': '#0284c7' },
        label: 'Океан',
        colorScheme: 'light',
      },
    },
  },
})
```

В сборке будут ровно `emerald` и `ocean`. Тем `light` и `dark` не будет:
`light` резолвится, но только как источник значений для `extends`.

Живой пример — [`apps/app-6`](../../apps/app-6/README.md).

### Поля определения

| Поле | Что делает |
|---|---|
| `extends` | имя темы, **эффективные** токены которой берутся за основу |
| `selector` | под каким селектором эмитить тему |
| `tokens` | собственные токены, **без** префикса `--` |
| `tokensRef` | то же, но значения читаются из CSS-файла (как `tokenDefinitionsRef` у провайдера) |
| `label` | подпись для переключателя; уезжает в манифест тем |
| `colorScheme` | `'light' \| 'dark'` — к какой системной схеме тяготеет тема |

### `names` и `define`

Как только `define` задано, а `names` — нет, **список тем сборки равен ключам
`define`**: приложение, объявившее свои темы, владеет списком целиком, и
`defaultThemes` провайдеров не смотрятся. Нужны и свои темы, и провайдерские —
перечислите всё в `names` явно:

```ts
themes: {
  names: ['dark', 'emerald'],       // главнее ключей define
  define: {
    emerald: { extends: 'light', tokens: { … } },
    dark:    { label: 'Тёмная' },   // определение без tokens/extends —
                                     // чистые метаданные поверх темы провайдера
  },
}
```

### Селектор

По умолчанию тема приложения эмитится под `[data-theme="<имя>"]`. Атрибут, а не
класс: он держит ровно одно значение, поэтому переключение между тремя и более
темами не требует вычищать классы предыдущей — и активация в манифесте
выводится однозначно.

Приложению с **единственной** темой обычно нужен `selector: ':root'` — тогда
тема активна по факту существования и рантайм-переключатель не нужен вовсе:

```ts
themes: {
  define: { brand: { extends: 'light', selector: ':root', tokens: { … } } },
}
```

Если у темы уже есть вклад провайдеров, а `selector` не задан — используется
селектор, выбранный ими.

### Что делает `extends`

Наследуются **эффективные** токены базы: провайдерский слой + компонентный +
собственное `define` базы, слитые в одну карту. Дальше:

- унаследованные токены **переезжают под селектор новой темы**. Это не деталь
  реализации: останься они на селекторе базы, тема включалась бы только вместе
  с базой;
- поэтому `extends`/`selector` **схлопывают тему в один блок**. Тема без них
  может оставаться мультиселекторной (см. выше);
- база **не обязана** входить в `names` — она резолвится ради значений и в CSS
  не попадает;
- цепочки допустимы (`ocean-hc extends ocean extends light`), циклы
  обрываются с предупреждением.

Наследовать можно только тему со **структурными** токенами
(`tokenDefinitions` / `tokenDefinitionsRef`). Тема, которую провайдер отдаёт
готовым CSS-файлом (`theme.themes[name]`), для пресета непрозрачна: пресет
инлайнит файл как есть и значений не знает. `granular doctor` покажет это как
`theme-extends-unresolved` с причиной `opaque` — лечится
[`tokenDefinitionsFromCss*`](#tokendefinitionsfromcss--апгрейд-тем-до-структурных-токенов).

### `tokensRef` — палитра в CSS, а не в TS

```ts
themes: {
  define: {
    crimson: {
      extends: 'light',
      tokensRef: new URL('./src/themes/crimson.css', import.meta.url).href,
    },
  },
}
```

Файл читает node-слой пресета при загрузке `uno.config.ts`; в клиентский бандл
он не попадает. Литеральные `tokens` имеют приоритет над значениями из файла.
Если у ссылки задан `as`, он становится селектором темы (когда явный `selector`
не указан). Относительный строковый путь резолвится от `process.cwd()`, поэтому
надёжнее указывать литералом `new URL(..., import.meta.url).href`.

### Диагностика

`npx granular doctor` показывает, что список тем пришёл из `themes.define`, и
предупреждает про `extends` в никуда (`theme-extends-unresolved`) и циклы
(`theme-extends-cycle`). Проверка «тему покрыли не все провайдеры»
(`partial-theme`) для тем, которые приложение поставляет само, не срабатывает:
провайдер и не обязан о них знать.

## Цепочка приоритетов

При слиянии токенов для конкретной `(темы, селектора, токена)` побеждает
самый высокий слой:

```
provider.theme.tokenDefinitions        (низший)
  → component.tokenDefinitions         (в порядке resolveSelection)
    → themes.define (app)              (в порядке extends: базы раньше)
      → themes.tokenOverrides (app)    (высший)
```

- Компонент может перебить провайдера.
- Приложение через `tokenOverrides` перебивает и провайдера, и компонент,
  а также может добавить новые токены, которых нет ниже.
- В режиме `strictTokens` токены, объявленные **компонентом**, также
  считаются «известными»: `tokenOverrides` на такой токен проходят без
  warning’а.

### `tokenOverrides` — две формы

Значение темы принимает одну из форм (различаются по типу значения):

```ts
themes: {
  names: ['light', 'dark'],
  tokenOverrides: {
    // 1. ПЛОСКАЯ — `{ token: value }` (без префикса `--`). Пишется в
    //    первичный селектор темы (обычно `:root`; создаётся, если у темы
    //    ещё нет блока). Обычный случай (см. apps/app-2).
    light: { brd: '#0070f3', 'card-fg': '#111' },

    // 2. ВЛОЖЕННАЯ — `{ selector: { token: value } }`. Целится в конкретный
    //    блок селектора мультиселекторной темы (создаётся при отсутствии).
    dark: {
      '.dark': { brd: '#334155' },
      '[data-theme="dark"]': { brd: '#1e293b' },
    },
  },
}
```

Токены пишутся **без** ведущего `--` в обеих формах.

## Переопределения со стороны приложения

```ts
presetGranularNode({
  providers: [...],
  components: [...],
  themes: {
    names: ['light', 'dark'],

    // заменить base.css глобально (применяется даже к провайдерам без `theme`
    // и эмитится один раз, независимо от числа провайдеров):
    baseFile: './app/base.css',

    // заменить tokens.css у конкретного провайдера:
    tokensFile: {
      '@feugene/simple-package': './app/simple-tokens.css',
    },
  },
})
```

## `tokenDefinitionsFromCss*` — апгрейд тем до структурных токенов

Если провайдер поставляет темы как обычный CSS (`:root { --brd: #000; }`),
можно одним вызовом в **node entry** провайдера превратить их в
**структурные** токены — это включит downstream `tokenOverrides` /
`strictTokens` без ручного дубляжа значений.

```ts
// granular-provider/node.ts
import { defineGranularProvider, resolvePackageBaseUrl } from '@feugene/unocss-preset-granular/contract'
import { tokenDefinitionsFromCssSync } from '@feugene/unocss-preset-granular/node'

const lightUrl = new URL('../styles/themes/light.css', import.meta.url).href
const darkUrl  = new URL('../styles/themes/dark.css',  import.meta.url).href

export default defineGranularProvider({
  id: '@your-scope/your-package',
  contractVersion: 1,
  packageBaseUrl: resolvePackageBaseUrl(import.meta.url),
  components: [/* ... */],
  theme: {
    baseCssUrl: new URL('../styles/base.css', import.meta.url).href,
    tokenDefinitions: {
      // разбор :root из light.css как есть
      light: tokenDefinitionsFromCssSync(lightUrl, { selector: ':root' }),

      // взять значения из :root в dark.css, но выдать их под селектором `.dark`
      dark:  tokenDefinitionsFromCssSync(darkUrl,  { selector: ':root', as: '.dark' }),
    },
    defaultThemes: ['light'],
  },
})
```

### API — `@feugene/unocss-preset-granular/node`

| Экспорт                                 | Назначение                                                                 |
|-----------------------------------------|----------------------------------------------------------------------------|
| `tokenDefinitionsFromCss`               | async; возвращает `{ selector, tokens }` для `tokenDefinitions[x]`.        |
| `tokenDefinitionsFromCssSync`           | sync‑вариант, применим на верхнем уровне модуля.                           |
| `parseCssCustomPropertyBlocks[Sync]`    | low‑level: все блоки с `--foo: bar;` из файла / data URL / CSS.            |

### Опции (`TokenDefinitionsFromCssOptions`)

- `selector` — какой блок выбрать (по умолчанию `:root`).
- `as` — переписать селектор в результате (например, `:root` → `.dark`).
- `strict` — по умолчанию `true`: кидать ошибку, если селектор не найден
  / нет custom properties / в файле есть неподдерживаемые вложенные или
  at‑rule‑блоки. `false` — fallback на первый блок (неподдерживаемые блоки
  при этом пропускаются с `console.warn`).

### Допустимые источники

Абсолютный путь, `file://` URL, `data:text/css,...`.

### Ограничения

- Только Node. Не импортируйте эти хелперы из браузерного entry
  (`granular-provider/index.ts`) — они используют `node:fs`.
- Парсер намеренно лёгкий (сопоставление скобок по очищенному от комментариев
  потоку). Он понимает **только плоские блоки верхнего уровня**: форма
  `{ selector, tokens }` не может выразить условный
  (`@media (...) { :root { ... } }`) или вложенный (`.dark { :root { ... } }`)
  блок. Такие блоки **пропускаются**, а не выдаются как безусловные:
  `strict: true` бросает ошибку, `strict: false` печатает один `console.warn`.
  Для файлов с `@media` / nesting / нетривиальным синтаксисом — запускайте
  `postcss` в коде своего провайдера; форма результата та же.
- Точка с запятой у последнего объявления в блоке необязательна, как и в CSS:
  `:root { --a: 1px; --b: 2px }` даёт оба токена.

## `tokenDefinitionsRef` — ссылки вместо обращения к FS

`tokenDefinitions` требует, чтобы значения у провайдера уже *были* на момент
объявления. Вычитать их из CSS-файла — значит позвать
`tokenDefinitionsFromCssSync` из `/node`, а этот импорт, оказавшись в
браузерном `config.ts`, утаскивает `node:fs` в клиентский бандл. Сборка при
этом не падает — ломается рантайм у потребителя.

`tokenDefinitionsRef` переворачивает задачу: провайдер объявляет, **где** лежат
токены, а файл читает node‑слой пресета при загрузке конфига приложения.
Ссылка — это данные, поэтому она безопасна в любом конфиге.

```ts
// components/XTokenized/config.ts — browser‑safe
export const xTokenizedConfig = defineGranularComponent(import.meta.url, {
  name: 'XTokenized',
  tokenDefinitionsRef: {
    light: new URL('./themes/light.css', import.meta.url).href,
    dark: {
      url: new URL('./themes/dark.css', import.meta.url).href,
      as: '.dark, [data-theme="dark"]',   // взять блок, эмитить под этим
    },
  },
})
```

То же поле есть у `provider.theme` — для package‑wide тем. Опции повторяют
`tokenDefinitionsFromCss`: `selector` (какой блок взять, по умолчанию `:root`),
`as` (под каким селектором эмитить), `strict` (по умолчанию `true`).

Если у темы есть и литеральный `tokenDefinitions`, и ссылка — побеждает
литерал: конкретное значение специфичнее, и это даёт провайдеру способ
переопределить собственную ссылку, не убирая её.

### Две формы ссылки

| Форма | Когда |
|---|---|
| `new URL('./themes/light.css', import.meta.url).href` | **Выбор по умолчанию.** Бандлер распознаёт этот литерал и либо эмитит файл ассетом, либо инлайнит его `data:`‑URL — CSS гарантированно есть в опубликованном пакете. |
| `'./themes/light.css'` (строка) | Только если файл и так эмитится по контрактному пути `components/<Name>/…` в `dist` — например, `styles.css` компонента, который туда кладёт `granularAssetFileNames()`. |

Разница не косметическая. Бандлер реагирует именно на **литерал**
`new URL(..., import.meta.url)`; строка для него — просто данные, файл в `dist`
не попадёт, и в опубликованном пакете ссылка повиснет. У строковой формы есть
fallback по `assetName` (`components/<Name>/<file>` от `packageBaseUrl` — ровно
как `cssFiles` → `cssFileAssetNames`), поэтому она и работает для файлов,
которые сборка действительно кладёт по контрактному пути.

Битая ссылка даёт `GranularTokenRefError` с указанием провайдера, компонента и
темы — и подсказкой про формы выше.

### Что это даёт

- Не нужен парный `config.node.ts` и импорт `/node` в браузерных конфигах —
  граница browser/node у провайдера держится по построению.
- Node‑слой знает **селектор** каждой темы, поэтому
  [переключение в рантайме](#переключение-тем-в-рантайме) выводит активацию
  само, без хардкода на стороне приложения.
- `granular doctor` и `strictTokens` видят эти токены как любые другие: к
  моменту, когда работает что-либо ниже по течению, ссылок уже не существует —
  они развёрнуты в `tokenDefinitions`.

## Переключение тем в рантайме

Все выбранные темы уже лежат в CSS — по блоку токенов на селектор. Поэтому
переключение темы в рантайме — это **не** перегенерация, а одна операция над
DOM, после которой начинает совпадать другой блок.

Загвоздка в том, что *селекторы* выбирает провайдер, а *переключение*
происходит в браузере. Прописать их в приложении руками — верный способ
разъехаться молча: несовпавший селектор не даёт ни ошибки, ни предупреждения,
просто ничего не меняется. Мостом служит **манифест тем**, который node-слой
строит из той же резолюции, из которой эмитится CSS.

### 1. Отдать манифест (сторона сборки)

```ts
// vite.config.ts
import { granularThemesPlugin } from '@feugene/unocss-preset-granular/node'
import { granularOptions } from './uno.config'

export default defineConfig({
  plugins: [vue(), UnoCSS(), granularThemesPlugin(granularOptions)],
})
```

Плагин отдаёт виртуальный модуль `virtual:granular-themes`. Передавайте в него
**тот же объект опций**, что и в пресет, — именно это гарантирует, что манифест
описывает реально эмитнутый CSS.

Объявление модуля для TypeScript:

```ts
// vite-env.d.ts
declare module 'virtual:granular-themes' {
  import type { GranularThemeManifest } from '@feugene/unocss-preset-granular/runtime'

  const manifest: GranularThemeManifest
  export default manifest
}
```

Не на Vite? Соберите манифест сами через `getGranularThemeManifest(options)` из
`/node` и доставьте в клиент как удобно (`define`, отдельный JSON, SSR-payload).

### 2. Переключать (сторона рантайма)

```ts
// theme.ts
import manifest from 'virtual:granular-themes'
import { createThemeController } from '@feugene/unocss-preset-granular/runtime'

export const themes = createThemeController(manifest)
```

```ts
themes.list()        // ['light', 'dark']
themes.get()         // 'light'
themes.set('dark')   // <html data-theme="dark">
themes.cycle()       // следующая по кругу — для одной кнопки
themes.subscribe(name => …)   // возвращает функцию отписки
themes.entry('dark')          // запись темы целиком: селекторы, активация, label
```

`entry(name).label` и `entry(name).colorScheme` приходят из
[`themes.define`](#собственные-темы-приложения-themesdefine). Подписи для
переключателя стоит брать оттуда: вторая, рукописная карта «имя → подпись»
разъезжается с конфигом молча.

`/runtime` — отдельная точка входа намеренно: там только типы, парсер
селекторов и контроллер. Ни FS, ни UnoCSS, ни зависимостей вообще — клиентский
бандл не тянет внутренности пресета.

Создавайте контроллер **до монтирования** фреймворка: применение синхронно,
поэтому первый кадр рисуется сразу в нужной теме, без вспышки чужой.

### Как выводится активация

Манифест превращает селектор провайдера в операцию над DOM:

| Селектор провайдера        | Активация                                          |
|----------------------------|----------------------------------------------------|
| `:root`, `html`            | `{ type: 'root' }` — активна всегда, включать нечего |
| `.dark`                    | `{ type: 'class', value: 'dark' }`                  |
| `[data-theme="dark"]`      | `{ type: 'attribute', name: 'data-theme', value: 'dark' }` |
| `.theme-dark, .dark, [data-theme="dark"]` | атрибутная — см. ниже                |
| всё остальное              | `{ type: 'unknown' }`                               |

Если тема перечисляет несколько альтернатив, побеждает **атрибут**: он
взаимоисключающий по природе (`data-theme` держит одно значение), поэтому
переключение между тремя и более темами не требует вычищать класс предыдущей.
При переключении контроллер сначала снимает активации всех остальных тем —
оставшийся класс продолжил бы перебивать новую тему по каскаду.

`unknown` означает, что сборка не смогла определить селектор: так бывает, когда
провайдер отдаёт тему готовым CSS-файлом (`theme.themes[name]`) — пресет
инлайнит его как есть и не знает, что внутри. `set()` на такой теме бросает
ошибку с этим объяснением. Выхода два: перевести провайдера на
`tokenDefinitions` (тогда селектор известен) или задать активацию явно:

```ts
granularThemesPlugin(granularOptions, {
  activations: { dark: { type: 'class', value: 'dark' } },
})
```

### Сохранение выбора и системная схема

По умолчанию контроллер запоминает выбор в `localStorage` (`granular-theme`), а
при отсутствии сохранённого — ориентируется на `prefers-color-scheme`.
Системная схема сопоставляется теме в три шага: явная опция `systemThemes` →
тема с именем `light`/`dark` → первая тема, объявившая `colorScheme` в
`themes.define`. Последний шаг и делает `auto` работоспособным в приложении,
где тем `light`/`dark` нет вовсе (см. `apps/app-6`): имя темы больше ничего не
обязано означать. Всё переопределяется:

```ts
createThemeController(manifest, {
  storage: null,                  // не запоминать
  storageKey: 'my-app:theme',
  initial: 'dark',                // вместо хранилища/системы
  systemThemes: { dark: 'midnight', light: 'daylight' },
  target: document.body,          // вместо <html>
})
```

Контроллер **не** подписывается на изменение системной схемы: пользователь,
выбравший тему руками, обычно не хочет, чтобы её перебила система. Нужно такое
поведение — добавьте слушатель `matchMedia`, вызывающий `set()`.

### Значения токенов в манифесте

По умолчанию манифест несёт только имена, селекторы и активации: значения уже в
CSS, и тащить их второй раз в JS незачем. Если они нужны самому приложению
(превью палитры, canvas, инлайн-стили):

```ts
granularThemesPlugin(granularOptions, { includeTokens: true })
// manifest.themes[0].tokens → { ':root': { brd: '#e2e8f0', … } }
```

Рабочий пример всего перечисленного — [`apps/app-5`](../../apps/app-5).

## `@apply` внутри per‑component `styles.css`

`cssFiles` подключаются как UnoCSS **preflights**. Трансформер UnoCSS
`transformer-directives` (разворачивает `@apply`, `@screen`, `theme()`)
работает только на стадии Vite‑transform обычных CSS‑модулей — по умолчанию
**не применяется** к preflights. Три практических варианта:

1. **Включите `expandDirectives`** (node entry). При
   `presetGranularNode({ ..., expandDirectives: true })` пресет прогоняет
   встраиваемый CSS (base / tokens / темы / `cssFiles`) через
   `transformer-directives` прямо в preflight, и `@apply` / `@screen` /
   `theme()` разворачиваются. Нужны разрешимые `unocss` (реэкспортит
   `transformerDirectives`) и `magic-string` — обе едут вместе с `unocss`;
   если их нет — CSS остаётся без изменений с одним `console.warn`.
2. **Положите CSS в SFC** (`<style src="./styles.css">` или inline
   `<style>`) и включите `transformerDirectives()` в `uno.config.ts`.
   SFC‑импорт CSS пройдёт через трансформер, `@apply` корректно
   развернётся.
3. **Оставьте `cssFiles`** для CSS, которому не нужно разворачивание
   директив (pure base, tokens, fonts). Комбинируйте по ситуации.
