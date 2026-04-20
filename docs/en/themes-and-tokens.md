# Themes and tokens

> See also: [Usage in apps](./usage-in-apps.md),
> [Authoring providers](./authoring-providers.md).

The preset has a simple, layered model for theming:

1. **`baseCssUrl`** — optional package‑wide base (normalize, resets, body
   defaults). One per provider.
2. **`tokensCssUrl`** — optional CSS with token **declarations** that are
   semantics‑neutral (e.g. `--font-sans`, `--radius-md`).
3. **`themes[themeName]`** — per‑theme CSS (e.g. `light.css`, `dark.css`).
   The app selects by name.
4. **`tokenDefinitions`** (node only, optional) — structural tokens parsed
   out of the theme CSS so UnoCSS can support `tokenOverrides` /
   `strictTokens` without value duplication.

Themes are expressed as a flat map `Record<themeName, cssUrl>` on the
provider. The app just lists the names it wants:

```ts
presetGranularNode({
  providers: [...],
  components: [...],
  themes: { names: ['light', 'dark'] },
})
```

By default, if `themes` is omitted, one theme — `light` — is emitted.

## Provider side

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

## App‑side overrides

```ts
presetGranularNode({
  providers: [...],
  components: [...],
  themes: {
    names: ['light', 'dark'],

    // replace base.css globally:
    baseFile: './app/base.css',

    // replace tokens.css per provider:
    tokensFile: {
      '@feugene/simple-package': './app/simple-tokens.css',
    },
  },
})
```

## `tokenDefinitionsFromCss*` — upgrading themes to structural tokens

If a provider ships themes as plain CSS (`:root { --brd: #000; }`), it can
expose them as **structural** tokens with a single call in its **node
entry** — enabling `tokenOverrides` / `strictTokens` downstream without
duplicating values.

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
      // parse :root from light.css as‑is
      light: tokenDefinitionsFromCssSync(lightUrl, { selector: ':root' }),

      // parse :root from dark.css but emit the tokens under `.dark`
      dark:  tokenDefinitionsFromCssSync(darkUrl,  { selector: ':root', as: '.dark' }),
    },
    defaultThemes: ['light'],
  },
})
```

### API — `@feugene/unocss-preset-granular/node`

| Export                                 | Purpose                                                                 |
|----------------------------------------|-------------------------------------------------------------------------|
| `tokenDefinitionsFromCss`              | async; returns `{ selector, tokens }` ready for `tokenDefinitions[x]`.  |
| `tokenDefinitionsFromCssSync`          | sync variant, usable at module top level.                               |
| `parseCssCustomPropertyBlocks[Sync]`   | low‑level: all blocks with `--foo: bar;` from a file / data URL / CSS.  |

### Options (`TokenDefinitionsFromCssOptions`)

- `selector` — which block to pick (default `:root`).
- `as` — rewrite the selector in the result (e.g. `:root` → `.dark`).
- `strict` — default `true`: throw if the selector is missing / no custom
  properties are found. Set to `false` to fall back to the first block.

### Accepted sources

Absolute path, `file://` URL, or `data:text/css,...`.

### Caveats

- Node‑only. Do **not** import these helpers from the browser entry
  (`granular-provider/index.ts`) — they use `node:fs`.
- The parser is intentionally lightweight (regex over a stripped‑comments
  stream). For files with `@media` / nesting / non‑trivial grammar, prefer
  running `postcss` in your own provider code — the return shape is the
  same.

## `@apply` inside per‑component `styles.css`

`cssFiles` are loaded as **preflights**. UnoCSS's `transformer-directives`
(which expands `@apply`, `@screen`, `theme()`) operates only at Vite's
transform stage on regular CSS modules — it does **not** apply to
preflights. Two practical options:

1. **Put the CSS inside the SFC** (`<style src="./styles.css">` or inline
   `<style>`) and enable `transformerDirectives()` in the app's
   `uno.config.ts`. The SFC‑imported CSS flows through the transformer and
   `@apply` resolves correctly.
2. **Keep `cssFiles`** for CSS that doesn't need directive expansion (pure
   base, tokens, fonts). Mix approaches as needed.

Automatic directive expansion for preflight CSS from `cssFiles` is a
roadmap item — see [Troubleshooting & recipes](./troubleshooting.md).
