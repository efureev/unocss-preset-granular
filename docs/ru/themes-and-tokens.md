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

## Слой компонента: `component.tokenDefinitions`

Любой компонент в `defineGranularComponent(...)` может публиковать свои
CSS‑токены для тем — не загрязняя общий набор токенов донор‑пакета.

```ts
// src/components/XTokenized/config.ts
defineGranularComponent(import.meta.url, {
  name: 'XTokenized',
  tokenDefinitions: {
    light: { selector: ':root', tokens: { '--x-tokenized': '#2563eb' } },
    dark:  { selector: '.dark', tokens: { '--x-tokenized': '#93c5fd' } },
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
