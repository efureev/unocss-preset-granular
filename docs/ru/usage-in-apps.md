# Использование в приложениях

> См. также: [Быстрый старт](./getting-started.md),
> [Сканирование компонентов](./component-scanning.md),
> [Темы и токены](./themes-and-tokens.md).

## Две точки входа

| Импорт                                       | Где использовать                       |
|----------------------------------------------|----------------------------------------|
| `@feugene/unocss-preset-granular`            | браузер / runtime / edge / sandboxes   |
| `@feugene/unocss-preset-granular/node`       | Node build‑time (Vite, CLI, тесты)     |
| `@feugene/unocss-preset-granular/contract`   | типы + `defineGranularComponent/Provider` для авторов провайдеров |

Для приложений на Vite почти всегда нужен `/node` — он читает CSS‑файлы с
диска, делает `src/ ↔ dist/` fallback и обеспечивает автосканирование
компонентов.

## Справочник опций (`presetGranular` / `presetGranularNode`)

| Опция                                   | Назначение                                                                              |
|-----------------------------------------|-----------------------------------------------------------------------------------------|
| `providers`                             | `GranularProvider[]` — обязательно; откуда тянутся классы/темы.                         |
| `components`                            | `'all'` \| `ComponentSelectionItem[]` (см. ниже).                                       |
| `themes.names`                          | Имена тем. По умолчанию `['light']`. Пустой массив — без тем.                           |
| `themes.baseFile` / `themes.tokensFile` | Переопределение `base.css` / `tokens.css` глобально или по `providerId`.                |
| `layer`                                 | UnoCSS‑layer, в который попадают preflights без собственного layer'а.                   |
| `preflights`                            | Дополнительные inline‑preflights, добавляемые приложением.                              |
| `includeProviderUnocss`                 | `false` — не тянуть `provider.unocss.*`. По умолчанию `true`.                           |
| `scan`                                  | Опции сканирования для `/node` (см. ниже).                                              |

### Селекторы `components`

```ts
components: [
  // квалифицированная короткая форма:
  '@feugene/simple-package:XTest1',

  // объектная форма — несколько имён из одного провайдера:
  { provider: '@feugene/simple-package', names: ['XTest1', 'XTestStyled'] },

  // короткая форма для конфига с одним провайдером (без квалификатора):
  // 'XTest1',
]
```

`components: 'all'` — удобно для демо/playground, но нежелательно в
продакшене: теряется смысл гранулярного выбора.

### `scan` (только для node)

```ts
presetGranularNode({
  // ...
  scan: {
    enabled: true,                 // по умолчанию true
    extensions: ['mdx'],           // доп. расширения к дефолтным js/mjs/cjs/ts/mts/cts/jsx/tsx/vue
    extraGlobs: [],                // доп. globs, добавляются как есть
    includeNodeModules: true,      // по умолчанию true — разрешить сканирование внутри node_modules
  },
})
```

Подробнее — в [Сканирование компонентов](./component-scanning.md).

## Хелпер `granularContent(options)` — обязателен

Плагин UnoCSS для Vite **не мержит** `content.filesystem`, возвращённый
пресетом — он читает `content.*` только из top‑level user‑конфига.
Поэтому:

```ts
import { presetGranularNode, granularContent } from '@feugene/unocss-preset-granular/node'

const granularOptions = { providers: [...], components: [...] }

export default defineConfig({
  presets: [presetMini(), presetGranularNode(granularOptions)],
  content: granularContent(granularOptions),        // ← обязательно
})
```

`granularContent(options)` возвращает:

```ts
{
  filesystem: string[],        // POSIX‑globs директорий выбранных компонентов
  pipeline: { include: RegExp[] } // см. ниже
}
```

`pipeline.include` устроен **точечно** — extractor не сканирует весь JS
приложения/`node_modules`, а расширяется до `.js/.mjs/.cjs/.ts/.mts/.cts`
**только внутри директорий выбранных компонентов** (в т.ч. их транзитивных
`dependencies`). Для остального кода остаётся стандартный фильтр UnoCSS
(`.vue/.ts/.tsx/.html/.md*/.astro/...`). Это важно, когда параллельно с
`presetGranularNode` подключён `presetMini`/`presetUno`: минифицированные
чанки Vue/других зависимостей НЕ попадут под extractor, и в итоговом CSS
не появятся «случайные» утилиты (`.ms`, `.mt`, `.block`, `.transform`,
`.shadow`, `.transition`, `.p[i]` и т.п.), собранные из подстрок
минификата.

Если у вас уже есть собственный `content`, разворачивайте оба:

```ts
content: {
  ...granularContent(granularOptions),
  filesystem: [
    ...granularContent(granularOptions).filesystem,
    'content/**/*.md',
  ],
}
```

## Переопределение тем

```ts
presetGranularNode({
  providers: [simpleProvider, extraProvider],
  components: [...],
  themes: {
    names: ['light', 'dark'],

    // глобальное переопределение для всех провайдеров:
    baseFile: './app/overrides/base.css',

    // per‑provider переопределение tokens.css:
    tokensFile: {
      '@feugene/simple-package': './app/overrides/simple-tokens.css',
    },
  },
})
```

Модель тем полностью описана в [Темы и токены](./themes-and-tokens.md),
включая структурные `tokenDefinitions`, `strictTokens` и рецепт «тёмная
тема на `.dark`».

## Почему не просто `safelist`?

Использовать `safelist` можно (и пресет его поддерживает), но:

- Дублируется источник правды — класс живёт и в шаблоне, и в конфиге, и
  они рассинхронизируются.
- Приложение должно знать реализацию каждого компонента.
- UnoCSS‑экстракторы всё равно нужны для `shadow-sm`, `rounded-[…]` и
  arbitrary‑значений.

Механика `content.filesystem` позволяет писать классы **только в шаблоне
компонента** и всё равно получать их в итоговом CSS. `safelist` остаётся
строго для **динамически** собираемых классов (например, `` `btn-${props.variant}` ``).
