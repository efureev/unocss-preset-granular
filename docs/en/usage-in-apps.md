# Usage in applications

> See also: [Getting started](./getting-started.md),
> [Component scanning](./component-scanning.md),
> [Themes and tokens](./themes-and-tokens.md).

## Two entry points

| Import                                          | Use it in                             |
|-------------------------------------------------|---------------------------------------|
| `@feugene/unocss-preset-granular`               | browser / runtime / edge / sandboxes  |
| `@feugene/unocss-preset-granular/node`          | Node build‑time (Vite, CLI, tests)    |
| `@feugene/unocss-preset-granular/contract`      | types + `defineGranularComponent/Provider` for provider authors |

For apps built with Vite you almost always want `/node` — it reads CSS files
from disk, resolves `src/ ↔ dist/` fallback, and powers automatic component
scanning.

## Options reference (`presetGranular` / `presetGranularNode`)

| Option                                  | Meaning                                                                              |
|-----------------------------------------|--------------------------------------------------------------------------------------|
| `providers`                             | `GranularProvider[]` — required; providers the app pulls classes/themes from.        |
| `components`                            | `'all'` \| `ComponentSelectionItem[]` (see below).                                   |
| `themes.names`                          | Theme names to emit. Default: `['light']`. Pass `[]` to emit no themes.              |
| `themes.baseFile` / `themes.tokensFile` | Override `base.css` / `tokens.css` globally or per `providerId`.                     |
| `layer`                                 | UnoCSS layer assigned to preflights that don't declare one themselves.               |
| `preflights`                            | Extra inline preflights injected by the app itself.                                  |
| `includeProviderUnocss`                 | If `false`, skip `provider.unocss.*`. Default: `true`.                               |
| `scan`                                  | Scan options for the `/node` entry (see below).                                      |

### `components` selectors

```ts
components: [
  // qualified short form:
  '@feugene/simple-package:XTest1',

  // object form — multiple names from the same provider:
  { provider: '@feugene/simple-package', names: ['XTest1', 'XTestStyled'] },

  // short form for a single‑provider setup (no qualifier needed):
  // 'XTest1',
]
```

Use `components: 'all'` to pull everything a provider ships — convenient for
design‑system demos, discouraged for production apps (defeats the purpose of
granular selection).

### `scan` (node only)

```ts
presetGranularNode({
  // ...
  scan: {
    enabled: true,                 // default: true
    extensions: ['mdx'],           // extra file extensions beyond js/mjs/cjs/ts/mts/cts/jsx/tsx/vue
    extraGlobs: [],                // extra globs appended as‑is
    includeNodeModules: true,      // default: true — allow scanning inside node_modules
  },
})
```

See [Component scanning](./component-scanning.md) for background on *why*
these options exist and the interplay with `granularContent(...)`.

## The `granularContent(options)` helper — mandatory

UnoCSS's Vite plugin **does not merge** `content.filesystem` that a preset
declares internally into its scanner — it only picks up `content.*` from the
top level of your user config. Therefore:

```ts
import { presetGranularNode, granularContent } from '@feugene/unocss-preset-granular/node'

const granularOptions = { providers: [...], components: [...] }

export default defineConfig({
  presets: [presetMini(), presetGranularNode(granularOptions)],
  content: granularContent(granularOptions),        // ← required
})
```

`granularContent(options)` returns:

```ts
{
  filesystem: string[],        // POSIX globs of selected component dirs
  pipeline: { include: RegExp[] } // see below
}
```

`pipeline.include` is **scoped**: the extractor does NOT scan arbitrary JS
from your app/`node_modules`. It extends the default UnoCSS filter to
`.js/.mjs/.cjs/.ts/.mts/.cts` **only inside the directories of the selected
components** (including their transitive `dependencies`). The rest of the
code keeps the default UnoCSS filter (`.vue/.ts/.tsx/.html/.md*/.astro/...`).
This matters when you pair `presetGranularNode` with `presetMini`/`presetUno`:
minified Vue/vendor chunks won't be fed to the extractor, so the final CSS
won't contain stray utilities (`.ms`, `.mt`, `.block`, `.transform`,
`.shadow`, `.transition`, `.p[i]` etc.) harvested from minified identifiers.

If you already have your own `content` config, spread both:

```ts
content: {
  ...granularContent(granularOptions),
  filesystem: [
    ...granularContent(granularOptions).filesystem,
    'content/**/*.md',
  ],
}
```

## Theme overrides

```ts
presetGranularNode({
  providers: [simpleProvider, extraProvider],
  components: [...],
  themes: {
    names: ['light', 'dark'],

    // global override for all providers:
    baseFile: './app/overrides/base.css',

    // per‑provider override of tokens.css:
    tokensFile: {
      '@feugene/simple-package': './app/overrides/simple-tokens.css',
    },
  },
})
```

See [Themes and tokens](./themes-and-tokens.md) for the full model, including
structural `tokenDefinitions`, `strictTokens`, and the dark‑as‑`.dark`
recipe.

## Why not just `safelist`?

You *can* keep using `safelist` (and the preset supports it), but:

- It duplicates the truth — a class lives both in the template and in the
  config, and they drift.
- It forces the app to know implementation details of every component.
- It skips UnoCSS extractors — which means `shadow-sm`, `rounded-[…]` and
  arbitrary values still require extractor support anyway.

The preset's `content.filesystem` machinery lets you write classes **only in
the component template** and still get them into the final CSS. Use
`safelist` strictly for **dynamically built** class strings that cannot be
statically extracted (e.g. `` `btn-${props.variant}` ``).
