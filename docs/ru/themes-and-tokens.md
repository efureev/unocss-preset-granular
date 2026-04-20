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
4. **`tokenDefinitions`** (только node, опц.) — структурные токены,
   распарсенные из темы, чтобы UnoCSS поддерживал `tokenOverrides` /
   `strictTokens` без дубляжа значений.

Темы — плоский `Record<themeName, cssUrl>` у провайдера; приложение
перечисляет нужные имена:

```ts
presetGranularNode({
  providers: [...],
  components: [...],
  themes: { names: ['light', 'dark'] },
})
```

Если `themes` опустить — эмитится одна тема `light`.

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

## Переопределения со стороны приложения

```ts
presetGranularNode({
  providers: [...],
  components: [...],
  themes: {
    names: ['light', 'dark'],

    // заменить base.css глобально:
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
  / нет custom properties. `false` — fallback на первый блок.

### Допустимые источники

Абсолютный путь, `file://` URL, `data:text/css,...`.

### Ограничения

- Только Node. Не импортируйте эти хелперы из браузерного entry
  (`granular-provider/index.ts`) — они используют `node:fs`.
- Парсер намеренно лёгкий (regex по очищенному от комментариев потоку).
  Для файлов с `@media` / nesting / нетривиальным синтаксисом — запускайте
  `postcss` в коде своего провайдера; форма результата та же.

## `@apply` внутри per‑component `styles.css`

`cssFiles` подключаются как UnoCSS **preflights**. Трансформер UnoCSS
`transformer-directives` (разворачивает `@apply`, `@screen`, `theme()`)
работает только на стадии Vite‑transform обычных CSS‑модулей — и **не
применяется** к preflights. Есть два практических варианта:

1. **Положите CSS в SFC** (`<style src="./styles.css">` или inline
   `<style>`) и включите `transformerDirectives()` в `uno.config.ts`.
   SFC‑импорт CSS пройдёт через трансформер, `@apply` корректно
   развернётся.
2. **Оставьте `cssFiles`** для CSS, которому не нужно разворачивание
   директив (pure base, tokens, fonts). Комбинируйте по ситуации.

Автоматическое применение `transformer-directives` к preflight‑CSS из
`cssFiles` — пункт бэклога, см.
[Рецепты и отладку](./troubleshooting.md).
