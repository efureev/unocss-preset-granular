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
4. **`provider.theme.tokenDefinitions`** (node only, optional) — structural
   tokens parsed out of the theme CSS at the package level; enables
   `tokenOverrides` / `strictTokens` without value duplication.
5. **`component.tokenDefinitions`** (optional, see
   [component-authoring.md](./component-authoring.md#7-component-level-theme-tokens-tokendefinitions))
   — same shape, but scoped to a single component. Merged on top of the
   provider layer in `resolveSelection` order (post‑order DFS); emitted
   only for active themes (intersection with `themes.names`).
6. **`themes.tokenOverrides`** (app, optional) — final app‑side
   overrides. **Highest priority** — beats anything from
   providers/components and may add brand‑new tokens.

Themes are expressed as a flat map `Record<themeName, cssUrl>` on the
provider. The app just lists the names it wants:

```ts
presetGranularNode({
  providers: [...],
  components: [...],
  themes: { names: ['light', 'dark'] },
})
```

If `themes` is omitted, the theme names come from the providers: the union of
every provider's `theme.defaultThemes` (transitive donors included), in
provider order, deduplicated. If no provider declares the field, the preset
falls back to a single `light` theme. `themes: { names: [] }` still means
*no themes at all* — it is not the same as omitting `themes`.

Run `npx granular doctor` to see which names were selected and where they came
from; it also flags a theme declared in `defaultThemes` but not actually
shipped by that provider, a theme only some providers cover, and the case
where more than one theme is activated by default (their blocks are emitted
at the same time — with overlapping selectors the last one wins).

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

## Component layer: `component.tokenDefinitions`

Any component declared with `defineGranularComponent(...)` can publish
its own CSS theme tokens — without leaking them into the package‑wide
token set.

```ts
// src/components/XTokenized/config.ts
defineGranularComponent(import.meta.url, {
  name: 'XTokenized',
  tokenDefinitions: {
    // NB: token keys are written WITHOUT the `--` prefix — the generator adds it.
    light: { selector: ':root', tokens: { 'x-tokenized': '#2563eb' } },
    dark:  { selector: '.dark', tokens: { 'x-tokenized': '#93c5fd' } },
  },
})
```

The preset walks the selected components in `resolveSelection`
(post‑order DFS) and merges their `tokenDefinitions` on top of the
provider layer. **Only active themes ship** to the final CSS (those
listed in `themes.names`). A component can also **create a theme from
scratch** when no provider declares it (the app lists the theme in
`themes.names`, no provider declares it — the component provides the
block).

Full list of use cases (single‑theme filtering, multi‑theme, overriding
a provider token, `strictTokens` behavior) is in
[component-authoring.md §7](./component-authoring.md#7-component-level-theme-tokens-tokendefinitions).

## Multi‑selector themes

A theme is **not** limited to a single selector. Token sets are grouped by
`selector` into `tokenRegistry[theme].blocks`, so different providers /
components can each contribute their own selector block to the same theme.
For example one provider ships `dark` under `.dark` and another under
`[data-theme="dark"]` — both blocks are emitted:

```css
.dark { --a: 1; }
[data-theme="dark"] { --b: 2; }
```

A token set declared **without** a `selector` merges into the theme's
**primary** (first‑seen) block instead of spawning a stray `:root` block.

## Priority chain

When merging tokens for a concrete `(theme, selector, token)` triple, the
highest layer wins:

```
provider.theme.tokenDefinitions        (lowest)
  → component.tokenDefinitions         (in resolveSelection order)
    → themes.tokenOverrides (app)      (highest)
```

- Components can override providers.
- App‑level `tokenOverrides` override both providers and components, and can
  add brand‑new tokens not declared below.
- Under `strictTokens`, tokens declared by a **component** are also treated
  as “known”: `tokenOverrides` for such tokens pass without a warning.

### `tokenOverrides` — two forms

The value for a theme accepts either shape (told apart by value type):

```ts
themes: {
  names: ['light', 'dark'],
  tokenOverrides: {
    // 1. FLAT — `{ token: value }` (no `--` prefix). Writes into the
    //    theme's primary selector (usually `:root`; created if the theme
    //    has no block yet). This is the common case (see apps/app-2).
    light: { brd: '#0070f3', 'card-fg': '#111' },

    // 2. NESTED — `{ selector: { token: value } }`. Targets a specific
    //    selector block of a multi‑selector theme (created if absent).
    dark: {
      '.dark': { brd: '#334155' },
      '[data-theme="dark"]': { brd: '#1e293b' },
    },
  },
}
```

Tokens are written **without** the leading `--` in both forms.

## App‑side overrides

```ts
presetGranularNode({
  providers: [...],
  components: [...],
  themes: {
    names: ['light', 'dark'],

    // replace base.css globally (applies even to providers without a `theme`,
    // and is emitted only once regardless of provider count):
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
  properties are found / the file contains unsupported nested or at‑rule
  blocks. Set to `false` to fall back to the first block (unsupported blocks
  are then reported via `console.warn` and skipped).

### Accepted sources

Absolute path, `file://` URL, or `data:text/css,...`.

### Caveats

- Node‑only. Do **not** import these helpers from the browser entry
  (`granular-provider/index.ts`) — they use `node:fs`.
- The parser is intentionally lightweight (brace matching over a
  stripped‑comments stream). It understands **only flat top‑level blocks**:
  the `{ selector, tokens }` shape cannot express a conditional
  (`@media (...) { :root { ... } }`) or nested (`.dark { :root { ... } }`)
  block. Such blocks are **skipped**, never emitted as unconditional ones —
  `strict: true` throws, `strict: false` prints one `console.warn`. For files
  with `@media` / nesting / non‑trivial grammar, prefer running `postcss` in
  your own provider code — the return shape is the same.
- The trailing `;` of the last declaration in a block is optional, as in CSS:
  `:root { --a: 1px; --b: 2px }` yields both tokens.

## `@apply` inside per‑component `styles.css`

`cssFiles` are loaded as **preflights**. UnoCSS's `transformer-directives`
(which expands `@apply`, `@screen`, `theme()`) operates only at Vite's
transform stage on regular CSS modules — by default it does **not** apply to
preflights. Three practical options:

1. **Enable `expandDirectives`** (node entry). Set
   `presetGranularNode({ ..., expandDirectives: true })` and the preset runs
   the injected CSS (base / tokens / themes / `cssFiles`) through
   `transformer-directives` inside the preflight, so `@apply`, `@screen` and
   `theme()` resolve. Requires `unocss` (re‑exports `transformerDirectives`)
   and `magic-string` to be resolvable — both ship with `unocss`; if they
   aren't, the CSS is left unchanged with a single `console.warn`.
2. **Put the CSS inside the SFC** (`<style src="./styles.css">` or inline
   `<style>`) and enable `transformerDirectives()` in the app's
   `uno.config.ts`. The SFC‑imported CSS flows through the transformer and
   `@apply` resolves correctly.
3. **Keep `cssFiles`** for CSS that doesn't need directive expansion (pure
   base, tokens, fonts). Mix approaches as needed.
