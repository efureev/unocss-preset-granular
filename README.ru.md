# `@feugene/unocss-preset-granular`

Универсальный UnoCSS‑preset, который агрегирует стили, темы и safelist из произвольного
числа **granular‑провайдеров** (пакетов компонентов). Пакет не знает ни про один
конкретный UI‑пакет — он работает исключительно поверх публичного контракта
`GranularProvider`. Все решения по набору компонентов и тем принимает конечное
приложение в своём `uno.config.ts`.

- **ESM only**, Node ≥ 22, TypeScript strict.
- Три entry: `.` (browser), `./node` (build‑time FS), `./contract` (типы + хелперы
  для авторов провайдеров).
- Transitive `dependencies` резолвятся через единый реестр компонентов — композит
  объявляет только свои классы, чужие собираются автоматически.
- Cross‑provider `dependencies` поддерживаются (`'providerId:Name'` или объектная
  форма `{ provider, components }`).
- Темы — плоский `Record<themeName, cssUrl>` у провайдера; приложение перечисляет
  нужные имена. По умолчанию подключается одна тема `light`.


## Установка

```bash
yarn add -D @feugene/unocss-preset-granular unocss
yarn add -D @feugene/granularity            # или любой другой granular-провайдер
```

Провайдер‑композит (напр. `@feugene/extra-granularity`) должен объявлять
`peerDependencies` на провайдеров‑доноров, которые он использует в `dependencies`.
Конечное приложение обязано установить все задействованные провайдеры само.

## Быстрый старт (node / build‑time)

```ts
// uno.config.ts
import {defineConfig} from 'unocss'
import presetWind4 from '@unocss/preset-wind4'
import {presetGranularNode} from '@feugene/unocss-preset-granular/node'
import granularityProvider from '@feugene/granularity/granular-provider/node'
import extraProvider from '@feugene/extra-granularity/granular-provider/node'

export default defineConfig({
    presets: [
        presetWind4(),
        presetGranularNode({
            providers: [granularityProvider, extraProvider],
            components: [
                '@feugene/extra-granularity:XgQuickForm',
                {provider: '@feugene/granularity', names: ['DsButton', 'DsInput']},
            ],
            themes: {names: ['light', 'dark']},
            layer: 'granular',
        }),
    ],
})
```

### Browser / runtime

```ts
// В средах без FS: @unocss/runtime, edge, песочницы.
import {presetGranular} from '@feugene/unocss-preset-granular'
import granularityProvider from '@feugene/granularity/granular-provider'

presetGranular({
    providers: [granularityProvider],
    components: [{provider: '@feugene/granularity', names: ['DsButton']}],
    // CSS-файлы должны быть предварительно подключены или переданы в `preflights`.
})
```

### Опции

| Опция                                   | Назначение                                                                    |
|-----------------------------------------|-------------------------------------------------------------------------------|
| `providers`                             | Массив `GranularProvider` (обязателен)                                        |
| `components`                            | `'all'` или массив селекторов — `'providerId:Name'` или `{ provider, names }` |
| `themes.names`                          | Имена тем. По умолчанию `['light']`. Пустой массив — без тем                  |
| `themes.baseFile` / `themes.tokensFile` | Override `base.css` / `tokens.css` (глобально или по `providerId`)            |
| `layer`                                 | UnoCSS layer для preflights, у которых ещё нет собственного                   |
| `preflights`                            | Дополнительные inline preflights приложения                                   |
| `includeProviderUnocss`                 | Отключить `provider.unocss.*` (по умолчанию `true`)                           |

## Авторам провайдеров

```ts
// packages/<your-package>/src/components/Button/config.ts
import {defineGranularComponent} from '@feugene/unocss-preset-granular/contract'

export const buttonConfig = defineGranularComponent(import.meta.url, {
    name: 'MyButton',
    safelist: ['my-button', 'my-button--primary'],
    cssFiles: ['./styles.css'],
    dependencies: [
        // короткая форма — компонент из ЭТОГО же провайдера:
        // 'MyIcon',
        // cross-provider:
        // '@feugene/granularity:DsIcon',
        // объектная форма:
        // { provider: '@feugene/granularity', components: ['DsIcon', 'DsLabel'] },
    ],
})
```

```ts
// packages/<your-package>/src/granular-provider/index.ts
import {defineGranularProvider} from '@feugene/unocss-preset-granular/contract'
import {buttonConfig} from '../components/Button/config'

export default defineGranularProvider({
    id: '@your-scope/your-package',
    contractVersion: 1,
    // URL корня пакетных ассетов. Для стабильной работы в dev (src/) и dist/chunks —
    // не используйте `new URL('..', import.meta.url)`, это литеральное выражение
    // rolldown заменяет на data:-URL при build'е. Вместо этого — runtime‑конкатенация:
    packageBaseUrl: `${import.meta.url.slice(0, import.meta.url.lastIndexOf('/', import.meta.url.lastIndexOf('/') - 1) + 1)}`,
    components: [buttonConfig],
    theme: {
        baseCssUrl: new URL('../styles/base.css', import.meta.url).href,
        tokensCssUrl: new URL('../styles/tokens.css', import.meta.url).href,
        themes: {
            light: new URL('../styles/themes/light.css', import.meta.url).href,
            dark: new URL('../styles/themes/dark.css', import.meta.url).href,
        },
    },
    unocss: {
        // Кастомные rules/variants/preflights, если они нужны компонентам пакета.
    },
})
```

Правила:

- `safelist` — **только свои** классы компонента. Транзитивные классы собираются
  ядром автоматически по графу `dependencies`.
- Если компонент использует примитивы из другого провайдера — перечислить их в
  `dependencies` (квалифицированная форма). Донор должен быть указан в
  `peerDependencies` вашего пакета.
- `packageBaseUrl` должен указывать на **директорию** пакета, а не на конкретный
  модуль. Это нужно node‑слою для fallback `src/ ↔ dist/`.

## Миграция с `presetGranularity*` из `@feugene/granularity`

Старые экспорты `presetGranularity` / `presetGranularityNode` / `resolvePresetGranularity*` /
`createGranularityCssPreflight*` / `granularitySafelist` / `granularityThemeUrls` из
`@feugene/granularity` **удалены** (breaking change, мажор `@feugene/granularity`).
Deprecated‑shim'ов нет. Переход — одномоментный.

Примерная замена:

```diff
- import { presetGranularityNode } from '@feugene/granularity/uno-node'
+ import { presetGranularNode } from '@feugene/unocss-preset-granular/node'
+ import granularityProvider from '@feugene/granularity/granular-provider/node'

  presetGranularityNode({
    components: ['DsButton'],
    themes: ['light', 'dark'],
    layer: 'granularity',
  })
+ presetGranularNode({
+   providers: [granularityProvider],
+   components: [{ provider: '@feugene/granularity', names: ['DsButton'] }],
+   themes: { names: ['light', 'dark'] },
+   layer: 'granular',
+ })
```

Browser‑вариант — аналогично через `@feugene/unocss-preset-granular` +
`@feugene/granularity/granular-provider`.

## Лицензия

См. [LICENSE](../../LICENSE).
