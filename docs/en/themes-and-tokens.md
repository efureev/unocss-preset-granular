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
6. **`themes.define`** (app, optional) — themes declared by the **app**: its
   own palette, inheritance from another theme via `extends`, a custom
   selector and metadata for the theme switcher. See
   [App‑owned themes](#app-owned-themes-themesdefine).
7. **`themes.tokenOverrides`** (app, optional) — final app‑side
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

Theme names are **arbitrary strings**. `light`/`dark` are not baked into the
core — they are merely the names providers traditionally pick.

Where the final list comes from, highest priority first:

1. `themes.names`, when set explicitly;
2. the keys of `themes.define`, when the app declares its own themes;
3. the union of every provider's `theme.defaultThemes` (transitive donors
   included), in provider order, deduplicated;
4. the core fallback — a single `light` theme.

`themes: { names: [] }` still means *no themes at all* — it is not the same as
omitting `themes`.

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

## App‑owned themes: `themes.define`

**The set of themes belongs to the app**, not to the providers. A provider
ships the values a theme can be built from; which themes exist in the build is
the app's call. An app may want exactly one theme, or three of its own, or
three of its own plus the provider's `dark`.

```ts
presetGranularNode({
  providers: [dsProvider],          // ships light and dark
  components: [...],
  themes: {
    define: {
      emerald: {
        extends: 'light',           // seed from light's effective tokens
        tokens: { 'app-bg': '#052e1f', 'app-accent': '#10b981' },
        label: 'Emerald',
        colorScheme: 'dark',
      },
      ocean: {
        extends: 'light',
        tokens: { 'app-bg': '#e0f2fe', 'app-accent': '#0284c7' },
        label: 'Ocean',
        colorScheme: 'light',
      },
    },
  },
})
```

The build contains exactly `emerald` and `ocean`. Neither `light` nor `dark`
ships: `light` is resolved, but only as a source of values for `extends`.

A working example — [`apps/app-6`](../../apps/app-6/README.md).

### Definition fields

| Field | What it does |
|---|---|
| `extends` | name of the theme whose **effective** tokens are used as the seed |
| `selector` | which selector the theme is emitted under |
| `tokens` | own tokens, **without** the `--` prefix |
| `tokensRef` | same, but values are read from a CSS file (like a provider's `tokenDefinitionsRef`) |
| `label` | switcher caption; travels into the theme manifest |
| `colorScheme` | `'light' \| 'dark'` — which system scheme the theme leans towards |

### `names` and `define`

As soon as `define` is set and `names` is not, **the build's theme list equals
the keys of `define`**: an app that declared its own themes owns the list in
full, and provider `defaultThemes` are not consulted. To get both your own and
the providers' themes, list everything in `names` explicitly:

```ts
themes: {
  names: ['dark', 'emerald'],       // outranks the keys of define
  define: {
    emerald: { extends: 'light', tokens: { … } },
    dark:    { label: 'Dark' },     // a definition without tokens/extends is
                                     // pure metadata on top of a provider theme
  },
}
```

### Selector

By default an app theme is emitted under `[data-theme="<name>"]`. An attribute
rather than a class: it holds exactly one value, so switching between three or
more themes never has to clear the previous theme's class — and the manifest
derives the activation unambiguously.

An app with a **single** theme usually wants `selector: ':root'` — the theme is
then active by virtue of existing, and no runtime switcher is needed at all:

```ts
themes: {
  define: { brand: { extends: 'light', selector: ':root', tokens: { … } } },
}
```

If the theme already has provider contributions and `selector` is omitted, the
selector they picked is reused.

### What `extends` does

It inherits the **effective** tokens of the base: the provider layer, the
component layer and the base's own `define`, merged into one map. Then:

- inherited tokens **move under the new theme's selector**. That is not an
  implementation detail: had they stayed on the base's selector, the theme
  would only ever activate together with the base;
- consequently `extends`/`selector` **collapse the theme into a single block**.
  A theme without them may stay multi‑selector (see above);
- the base does **not** have to be in `names` — it is resolved for its values
  and never reaches the CSS;
- chains are allowed (`ocean-hc extends ocean extends light`); cycles are
  broken with a warning.

Only a theme with **structural** tokens (`tokenDefinitions` /
`tokenDefinitionsRef`) can be inherited. A theme the provider ships as a ready
CSS file (`theme.themes[name]`) is opaque to the preset: it inlines the file
as‑is and does not know the values. `granular doctor` reports this as
`theme-extends-unresolved` with reason `opaque` — the cure is
[`tokenDefinitionsFromCss*`](#tokendefinitionsfromcss--upgrading-themes-to-structural-tokens).

### `tokensRef` — the palette in CSS, not in TS

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

The preset's node layer reads the file while `uno.config.ts` is loading; it
never reaches the client bundle. Literal `tokens` take priority over the values
from the file. If the ref declares `as`, it becomes the theme's selector (when
no explicit `selector` is given). A relative string path resolves against
`process.cwd()`, so `new URL(..., import.meta.url).href` is the safer form.

### Diagnostics

`npx granular doctor` reports that the theme list came from `themes.define`,
and warns about an `extends` pointing nowhere (`theme-extends-unresolved`) and
about cycles (`theme-extends-cycle`). The “not every provider covers this
theme” check (`partial-theme`) does not fire for themes the app ships itself —
a provider is not expected to know about them.

## Priority chain

When merging tokens for a concrete `(theme, selector, token)` triple, the
highest layer wins:

```
provider.theme.tokenDefinitions        (lowest)
  → component.tokenDefinitions         (in resolveSelection order)
    → themes.define (app)              (in extends order: bases first)
      → themes.tokenOverrides (app)    (highest)
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

## `tokenDefinitionsRef` — references instead of FS access

`tokenDefinitions` requires the provider to *have* the values at declaration
time. Reading them out of a CSS file means calling
`tokenDefinitionsFromCssSync` from `/node` — and that import, sitting in a
browser‑side `config.ts`, drags `node:fs` into the client bundle. Nothing fails
at build time; the consumer's runtime does.

`tokenDefinitionsRef` inverts it: the provider declares **where** the tokens
live, and the preset's node layer reads the file while the app's config loads.
A reference is plain data, so it is safe in any config.

```ts
// components/XTokenized/config.ts — browser‑safe
export const xTokenizedConfig = defineGranularComponent(import.meta.url, {
  name: 'XTokenized',
  tokenDefinitionsRef: {
    light: new URL('./themes/light.css', import.meta.url).href,
    dark: {
      url: new URL('./themes/dark.css', import.meta.url).href,
      as: '.dark, [data-theme="dark"]',   // take the block, emit it under this
    },
  },
})
```

The same field exists on `provider.theme` for package‑wide themes. Options
mirror `tokenDefinitionsFromCss`: `selector` (which block to take, default
`:root`), `as` (which selector to emit it under), `strict` (default `true`).

If a theme has **both** a literal `tokenDefinitions` entry and a reference, the
literal wins — a concrete value is more specific, and it lets a provider
override its own reference without removing it.

### Two forms of a reference

| Form | When |
|---|---|
| `new URL('./themes/light.css', import.meta.url).href` | **Default choice.** The bundler recognises this literal and either emits the file as an asset or inlines it as a `data:` URL — so the CSS is guaranteed to exist in the published package. |
| `'./themes/light.css'` (plain string) | Only when the file is already emitted under the contract path `components/<Name>/…` in `dist` — e.g. a component's `styles.css` routed there by `granularAssetFileNames()`. |

The difference is not cosmetic. A bundler only reacts to the **literal**
`new URL(..., import.meta.url)`; a plain string is just data it knows nothing
about, so the file is never copied into `dist` and the reference dangles in the
published package. The string form has an `assetName` fallback
(`components/<Name>/<file>` relative to `packageBaseUrl`, exactly like
`cssFiles` → `cssFileAssetNames`), which is why it works for files that the
build does emit at the contract path.

A broken reference raises `GranularTokenRefError` naming the provider, the
component and the theme — and pointing at the form above.

### What it buys you

- No `config.node.ts` twin, no `/node` import in browser configs — the
  browser/node boundary of the provider holds by construction.
- The node layer knows the **selector** of every theme, so
  [runtime switching](#switching-themes-at-runtime) can derive its activation
  instead of the app hard‑coding it.
- `granular doctor` and `strictTokens` see these tokens like any other: by the
  time anything downstream runs, references no longer exist — they have been
  materialised into `tokenDefinitions`.

## Switching themes at runtime

Every selected theme is already in the CSS — one token block per selector. So
switching a theme at runtime is **not** a re‑generation: it is a single DOM
operation that makes another block match.

The catch is that the *selectors* are chosen by the provider while the
*switching* happens in the browser. Hard‑coding them in the app is how the two
drift apart silently: a selector that no longer matches produces no error and
no warning — nothing simply changes. The bridge is a **theme manifest**, built
by the node layer from the same resolution that emits the CSS.

### 1. Expose the manifest (build side)

```ts
// vite.config.ts
import { granularThemesPlugin } from '@feugene/unocss-preset-granular/node'
import { granularOptions } from './uno.config'

export default defineConfig({
  plugins: [vue(), UnoCSS(), granularThemesPlugin(granularOptions)],
})
```

The plugin serves a virtual module `virtual:granular-themes`. Pass it **the
same options object** you pass to the preset — that is what guarantees the
manifest describes the CSS that was actually emitted.

Declare the module for TypeScript:

```ts
// vite-env.d.ts
declare module 'virtual:granular-themes' {
  import type { GranularThemeManifest } from '@feugene/unocss-preset-granular/runtime'

  const manifest: GranularThemeManifest
  export default manifest
}
```

Not on Vite? Build the manifest yourself with
`getGranularThemeManifest(options)` from `/node` and hand it to the client the
way you prefer (`define`, an emitted JSON file, SSR payload).

### 2. Switch (runtime side)

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
themes.cycle()       // next one, for a single button
themes.subscribe(name => …)   // returns an unsubscribe function
themes.entry('dark')          // the whole entry: selectors, activation, label
```

`entry(name).label` and `entry(name).colorScheme` come from
[`themes.define`](#app-owned-themes-themesdefine). Take switcher captions from
there: a second, hand‑written “name → caption” map drifts from the config
silently.

`/runtime` is a separate entry point on purpose: it carries types, a selector
parser and the controller — no FS, no UnoCSS, no dependencies at all, so the
client bundle stays free of preset internals.

Create the controller **before mounting** your framework: applying a theme is
synchronous, so the first frame is painted in the right theme instead of
flashing another one.

### How activation is derived

The manifest turns the provider's selector into a DOM operation:

| Provider selector          | Activation                                        |
|----------------------------|---------------------------------------------------|
| `:root`, `html`            | `{ type: 'root' }` — always on, nothing to toggle  |
| `.dark`                    | `{ type: 'class', value: 'dark' }`                 |
| `[data-theme="dark"]`      | `{ type: 'attribute', name: 'data-theme', value: 'dark' }` |
| `.theme-dark, .dark, [data-theme="dark"]` | the attribute one — see below       |
| anything else              | `{ type: 'unknown' }`                              |

When a theme lists several alternatives, the **attribute** wins: it is
mutually exclusive by nature (`data-theme` holds one value), so switching
between three or more themes needs no clean‑up of the previous theme's class.
Switching always removes the other themes' activations first — a leftover
class would keep overriding the new theme through the cascade.

`unknown` means the build could not tell: it happens when a provider ships a
theme as a ready‑made CSS file (`theme.themes[name]`) — the preset inlines the
file as is and does not know what is inside. `set()` on such a theme throws
with that explanation. Two ways out: move the provider to `tokenDefinitions`
(then the selector is known), or state the activation explicitly:

```ts
granularThemesPlugin(granularOptions, {
  activations: { dark: { type: 'class', value: 'dark' } },
})
```

### Persistence and system preference

By default the controller remembers the choice in `localStorage`
(`granular-theme`) and, when there is nothing stored, follows
`prefers-color-scheme`. The system scheme maps to a theme in three steps: the
explicit `systemThemes` option → a theme literally named `light`/`dark` → the
first theme that declared `colorScheme` in `themes.define`. That last step is
what makes `auto` work in an app with no `light`/`dark` themes at all (see
`apps/app-6`): a theme's name no longer has to mean anything. Everything is
overridable:

```ts
createThemeController(manifest, {
  storage: null,                  // do not persist
  storageKey: 'my-app:theme',
  initial: 'dark',                // instead of stored/system detection
  systemThemes: { dark: 'midnight', light: 'daylight' },
  target: document.body,          // instead of <html>
})
```

The controller does **not** subscribe to system scheme changes: a user who
picked a theme by hand usually does not want the system to override it. If you
want that behaviour, add a `matchMedia` listener that calls `set()`.

### Token values in the manifest

By default the manifest carries only names, selectors and activations — the
values are already in the CSS and shipping them again in JS would bloat the
bundle. If the app itself needs them (palette preview, canvas, inline styles):

```ts
granularThemesPlugin(granularOptions, { includeTokens: true })
// manifest.themes[0].tokens → { ':root': { brd: '#e2e8f0', … } }
```

A working example of all of the above: [`apps/app-5`](../../apps/app-5).

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
