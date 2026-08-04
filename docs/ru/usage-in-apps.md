# Использование в приложениях

> См. также: [Быстрый старт](./getting-started.md),
> [Сканирование компонентов](./component-scanning.md),
> [Темы и токены](./themes-and-tokens.md).

## Пять точек входа

| Импорт                                     | Где использовать                                                                   |
|--------------------------------------------|------------------------------------------------------------------------------------|
| `@feugene/unocss-preset-granular`          | браузер / runtime / edge / sandboxes                                               |
| `@feugene/unocss-preset-granular/node`     | Node build‑time (Vite, CLI, тесты)                                                 |
| `@feugene/unocss-preset-granular/contract` | типы + `defineGranularComponent/Provider` для авторов провайдеров                  |
| `@feugene/unocss-preset-granular/vite`     | `granularChunkFileNames` / `granularAssetFileNames` для Vite‑сборки **провайдера** |
| `@feugene/unocss-preset-granular/runtime`  | браузеру — `createThemeController` для переключения тем                            |

Для приложений на Vite почти всегда нужен `/node` — он читает CSS‑файлы с диска, делает fallback для `cssFiles` (см.
[Архитектуру](./architecture.md#файловые-конвенции)) и обеспечивает автосканирование компонентов. Entry `/vite` нужен
только пакетам‑провайдерам, приложению — никогда.

## Справочник опций (`presetGranular` / `presetGranularNode`)

| Опция                                   | Назначение                                                                                                                                                                                                                                                                           |
|-----------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `providers`                             | `GranularProvider[]` — обязательно; откуда тянутся классы/темы.                                                                                                                                                                                                                      |
| `components`                            | `'all'` \| `ComponentSelectionItem[]` (см. ниже).                                                                                                                                                                                                                                    |
| `themes.names`                          | Имена тем. Опустить — ключи `themes.define`, иначе `theme.defaultThemes` провайдеров (объединение, фолбэк `['light']`). Пустой массив — без тем.                                                                                                                                     |
| `themes.define`                         | Темы, объявленные приложением: `extends`, `selector`, `tokens`/`tokensRef`, `label`, `colorScheme`. См. [Собственные темы приложения](./themes-and-tokens.md#собственные-темы-приложения-themesdefine).                                                                              |
| `themes.baseFile` / `themes.tokensFile` | Переопределение `base.css` / `tokens.css` глобально или по `providerId`.                                                                                                                                                                                                             |
| `layer`                                 | UnoCSS‑слой для всего, что эмитит пресет. По умолчанию `'granular'` (порядок слоя тоже объявляется). `null` — без слоя.                                                                                                                                                              |
| `preflights`                            | Дополнительные inline‑preflights, добавляемые приложением.                                                                                                                                                                                                                           |
| `includeProviderUnocss`                 | `false` — не тянуть `provider.unocss.*`. По умолчанию `true`.                                                                                                                                                                                                                        |
| `includeExtraRules`                     | `false` — не добирать утилиты, которых нет в `presetMini` (`animate-*`, `space-*`, `divide-*`, `backdrop-*`, `uppercase` и прочие `text-transform`), из `@feugene/unocss-mini-extra-rules`. По умолчанию `true`: компоненты этими утилитами пользуются, а без правил класс остаётся в разметке, и CSS к нему не появляется. |
| `scan`                                  | Опции сканирования для `/node` (см. ниже).                                                                                                                                                                                                                                           |
| `expandDirectives`                      | Только `/node`. `true` — раскрывать `@apply`/`@screen`/`theme()` во встраиваемом preflight‑CSS. По умолчанию `false`.                                                                                                                                                                |

### Селекторы `components`

```ts
components: [
    // квалифицированная короткая форма:
    '@feugene/simple-package:XTest1',

    // объектная форма — несколько имён из одного провайдера:
    {provider: '@feugene/simple-package', names: ['XTest1', 'XTestStyled']},
]
```

Голое `'Name'` — **не** валидный селектор на уровне приложения, пресет бросит `Invalid component key`. Короткая форма
работает только внутри
`dependencies` самого компонента, где провайдер подразумевается.

`components: 'all'` — удобно для демо/playground, но нежелательно в продакшене: теряется смысл гранулярного выбора.

### `scan` (только для node)

```ts
presetGranularNode({
    // ...
    scan: {
        enabled: true,                 // по умолчанию true
        extensions: ['mdx'],           // ДОБАВЛЯЮТСЯ к дефолтным js/mjs/cjs/ts/mts/cts/jsx/tsx/vue
        replaceExtensions: false,      // true — `extensions` заменяет дефолтные, а не дополняет
        extraGlobs: [],                // доп. globs, добавляются как есть
        includeNodeModules: true,      // по умолчанию true — разрешить сканирование внутри node_modules
    },
})
```

Подробнее — в [Сканирование компонентов](./component-scanning.md).

## Хелпер `granularContent(options)` — обязателен

Плагин UnoCSS для Vite **не мержит** `content.filesystem`, возвращённый пресетом — он читает `content.*` только из
top‑level user‑конфига. Поэтому:

```ts
import {presetGranularNode, granularContent} from '@feugene/unocss-preset-granular/node'

const granularOptions = {providers: [...], components: [...]}

export default defineConfig({
    presets: [presetMini(), presetGranularNode(granularOptions)],
    content: granularContent(granularOptions),        // ← обязательно
})
```

> 💡 **Рекомендуется:** оборачивайте обе половины в единый билдер
> `defineGranular(options)` — тогда `preset()` и `content()` не рассинхронятся,
> а резолюция считается один раз и мемоизируется:
>
> ```ts
> import { defineGranular } from '@feugene/unocss-preset-granular/node'
>
> const g = defineGranular({ providers: [...], components: [...] })
>
> export default defineConfig({
>   presets: [presetMini(), g.preset()],
>   content: g.content(),
> })
> ```

`granularContent(options)` возвращает:

```ts
{
    filesystem: string[],        // POSIX‑globs директорий выбранных компонентов
        pipeline
:
    {
        include: RegExp[]
    } // см. ниже
}
```

`pipeline.include` устроен **точечно** — extractor не сканирует весь JS приложения/`node_modules`, а расширяется до
`.js/.mjs/.cjs/.ts/.mts/.cts`
**только внутри директорий выбранных компонентов** (в т.ч. их транзитивных
`dependencies`). Для остального кода остаётся стандартный фильтр UnoCSS (`.vue/.ts/.tsx/.html/.md*/.astro/...`). Это
важно, когда параллельно с
`presetGranularNode` подключён `presetMini`/`presetUno`: минифицированные чанки Vue/других зависимостей НЕ попадут под
extractor, и в итоговом CSS не появятся «случайные» утилиты (`.ms`, `.mt`, `.block`, `.transform`,
`.shadow`, `.transition`, `.p[i]` и т.п.), собранные из подстрок минификата.

Если у вас уже есть собственный `content`, разворачивайте оба:

```ts
content: {
...
    granularContent(granularOptions),
        filesystem
:
    [
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

Модель тем полностью описана в [Темы и токены](./themes-and-tokens.md), включая структурные `tokenDefinitions`,
`strictTokens` и рецепт «тёмная тема на `.dark`».

## Почему не просто `safelist`?

Использовать `safelist` можно (и пресет его поддерживает), но:

- Дублируется источник правды — класс живёт и в шаблоне, и в конфиге, и они рассинхронизируются.
- Приложение должно знать реализацию каждого компонента.
- UnoCSS‑экстракторы всё равно нужны для `shadow-sm`, `rounded-[…]` и arbitrary‑значений.

Механика `content.filesystem` позволяет писать классы **только в шаблоне компонента** и всё равно получать их в итоговом
CSS. `safelist` остаётся строго для **динамически** собираемых классов (например, `` `btn-${props.variant}` ``).
