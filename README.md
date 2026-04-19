# `@feugene/unocss-preset-granular`

A universal UnoCSS preset that aggregates styles, themes and safelist from an
arbitrary number of **granular providers** (component packages). The preset is
not aware of any particular UI package — it works purely on top of the public
`GranularProvider` contract. All decisions about the set of components and
themes are made by the end application in its `uno.config.ts`.

- **ESM only**, Node ≥ 22, TypeScript strict.
- Three entries: `.` (browser), `./node` (build‑time FS), `./contract` (types +
  helpers for provider authors).
- Transitive `dependencies` are resolved through a single component registry —
  a composite provider declares only its own classes, the rest are collected
  automatically.
- Cross‑provider `dependencies` are supported (`'providerId:Name'` or the
  object form `{ provider, components }`).
- Themes are a flat `Record<themeName, cssUrl>` on the provider; the app lists
  the names it needs. By default one theme — `light` — is enabled.


## Installation

```bash
yarn add -D @feugene/unocss-preset-granular unocss
yarn add -D @feugene/granularity            # or any other granular provider
```

A composite provider (e.g. `@feugene/extra-granularity`) must declare
`peerDependencies` on the donor providers it uses in `dependencies`. The end
application is responsible for installing all involved providers itself.

## Quick start (node / build‑time)

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
// For environments without FS: @unocss/runtime, edge, sandboxes.
import {presetGranular} from '@feugene/unocss-preset-granular'
import granularityProvider from '@feugene/granularity/granular-provider'

presetGranular({
    providers: [granularityProvider],
    components: [{provider: '@feugene/granularity', names: ['DsButton']}],
    // CSS files must be preloaded beforehand or passed via `preflights`.
})
```

### Options

| Option                                  | Purpose                                                                         |
|-----------------------------------------|---------------------------------------------------------------------------------|
| `providers`                             | Array of `GranularProvider` (required)                                          |
| `components`                            | `'all'` or an array of selectors — `'providerId:Name'` or `{ provider, names }` |
| `themes.names`                          | Theme names. Defaults to `['light']`. Empty array — no themes                   |
| `themes.baseFile` / `themes.tokensFile` | Override `base.css` / `tokens.css` (globally or by `providerId`)                |
| `layer`                                 | UnoCSS layer for preflights that don't have one of their own                    |
| `preflights`                            | Extra inline preflights from the application                                    |
| `includeProviderUnocss`                 | Disable `provider.unocss.*` (default `true`)                                    |

## For provider authors

```ts
// packages/<your-package>/src/components/Button/config.ts
import {defineGranularComponent} from '@feugene/unocss-preset-granular/contract'

export const buttonConfig = defineGranularComponent(import.meta.url, {
    name: 'MyButton',
    safelist: ['my-button', 'my-button--primary'],
    cssFiles: ['./styles.css'],
    dependencies: [
        // short form — a component from THIS same provider:
        // 'MyIcon',
        // cross-provider:
        // '@feugene/granularity:DsIcon',
        // object form:
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
    // URL of the package assets root. For stable behavior in dev (src/) and
    // dist/chunks — do not use `new URL('..', import.meta.url)`: this literal
    // expression is replaced with a data: URL by rolldown at build time.
    // Use runtime concatenation instead:
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
        // Custom rules/variants/preflights, if the package components need them.
    },
})
```

Rules:

- `safelist` — **only the component's own** classes. Transitive classes are
  collected by the core automatically via the `dependencies` graph.
- If a component uses primitives from another provider — list them in
  `dependencies` (qualified form). The donor must be listed in the
  `peerDependencies` of your package.
- `packageBaseUrl` must point to the package **directory**, not to a specific
  module. The node layer needs this for `src/ ↔ dist/` fallback.

### Node helpers: `tokenDefinitions` from a CSS file

If a provider already ships themes as plain CSS files (`:root { --brd: ... }`),
it can upgrade from Level 1 (file) to Level 2 (structural tokens) with a single
call in its **node entry**. This enables app‑side `tokenOverrides` /
`strictTokens` without hand‑duplicating the values.

```ts
// packages/<your-package>/src/granular-provider/node.ts
import {defineGranularProvider} from '@feugene/unocss-preset-granular/contract'
import {tokenDefinitionsFromCssSync} from '@feugene/unocss-preset-granular/node'

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
            light: tokenDefinitionsFromCssSync(lightUrl, {selector: ':root'}),
            // pull values out of `:root` but emit them under `.dark`:
            dark:  tokenDefinitionsFromCssSync(darkUrl,  {selector: ':root', as: '.dark'}),
        },
        defaultThemes: ['light'],
    },
})
```

API (exported from `@feugene/unocss-preset-granular/node`):

| Export                                 | Purpose                                                                 |
|----------------------------------------|-------------------------------------------------------------------------|
| `tokenDefinitionsFromCss`              | async; returns `{ selector, tokens }` ready for `tokenDefinitions[x]`   |
| `tokenDefinitionsFromCssSync`          | sync variant, usable at module top level                                |
| `parseCssCustomPropertyBlocks[Sync]`   | low‑level: all blocks with `--foo: bar;` from a file / data URL / CSS   |

Options (`TokenDefinitionsFromCssOptions`):

- `selector` — which block to pick, default `:root`.
- `as` — rewrite the selector in the result (e.g. `:root` → `.dark`).
- `strict` — default `true`: throw if the selector is missing / no custom
  properties are found. Set to `false` to fall back to the first block.

Accepted sources: absolute path, `file://` URL, `data:text/css,...`.

Caveats:

- Node only. Do **not** import these helpers from your browser entry
  (`granular-provider/index.ts`) — they use `node:fs`.
- The parser is intentionally lightweight (regex over a stripped‑comments
  stream). For files with `@media` / nesting / non‑trivial grammar prefer
  `postcss` in your own provider code — the return shape is the same.

## Migration from `presetGranularity*` in `@feugene/granularity`

The old exports `presetGranularity` / `presetGranularityNode` /
`resolvePresetGranularity*` / `createGranularityCssPreflight*` /
`granularitySafelist` / `granularityThemeUrls` from `@feugene/granularity` have
been **removed** (breaking change, major bump of `@feugene/granularity`). There
are no deprecated shims. The migration is one‑shot.

Rough replacement:

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

Browser variant — analogous, via `@feugene/unocss-preset-granular` +
`@feugene/granularity/granular-provider`.

## License

See [LICENSE](../../LICENSE).
