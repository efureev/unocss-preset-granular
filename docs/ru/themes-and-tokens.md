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
6. **`themes.tokenOverrides`** (app, опц.) — финальные переопределения
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

Если `themes` опустить, имена тем берутся у провайдеров: объединение
`theme.defaultThemes` всех провайдеров (включая транзитивных доноров) в
порядке провайдеров, с дедупом. Если поле не объявил никто — фолбэк на одну
тему `light`. `themes: { names: [] }` по-прежнему означает *тем нет вовсе* —
это не то же самое, что опустить `themes`.

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

## Цепочка приоритетов

При слиянии токенов для конкретной `(темы, селектора, токена)` побеждает
самый высокий слой:

```
provider.theme.tokenDefinitions        (низший)
  → component.tokenDefinitions         (в порядке resolveSelection)
    → themes.tokenOverrides (app)      (высший)
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
import { defineGranularProvider } from '@feugene/unocss-preset-granular/contract'
import { tokenDefinitionsFromCssSync } from '@feugene/unocss-preset-granular/node'

const lightUrl = new URL('../styles/themes/light.css', import.meta.url).href
const darkUrl  = new URL('../styles/themes/dark.css',  import.meta.url).href

export default defineGranularProvider({
  id: '@your-scope/your-package',
  contractVersion: 1,
  packageBaseUrl: `${import.meta.url.slice(0, import.meta.url.lastIndexOf('/', import.meta.url.lastIndexOf('/') - 1) + 1)}`,
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
