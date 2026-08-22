# Authoring provider packages

A **granular provider** is a regular npm package that exposes a
`GranularProvider` object via the
`@feugene/unocss-preset-granular/contract` helpers. The end application picks
it up through its `uno.config.ts` and pulls in only the components / themes it
actually uses.

> See also: [Component authoring rules](./component-authoring.md) —
> single consolidated guide for authoring **one** component inside a
> provider package,
> [Architecture](./architecture.md),
> [Component scanning](./component-scanning.md).

## Package layout

Recommended layout (this is what the reference packages
`@feugene/simple-package` / `@feugene/extra-simple-package`
use):

```
packages/<your-package>/
├─ src/
│  ├─ components/
│  │  ├─ MyButton/
│  │  │  ├─ MyButton.vue
│  │  │  ├─ config.ts        ← defineGranularComponent(...)
│  │  │  ├─ styles.css       ← component‑local CSS (optional)
│  │  │  └─ index.ts         ← re‑export of the component
│  │  └─ MyIcon/
│  │     └─ ...
│  ├─ styles/
│  │  ├─ base.css
│  │  ├─ tokens.css
│  │  └─ themes/{light,dark}.css
│  └─ granular-provider/
│     ├─ index.ts            ← browser entry (default export = provider)
│     └─ node.ts             ← optional node entry (tokenDefinitions, FS‑only helpers)
├─ package.json              ← must expose the granular-provider subpaths
└─ vite.config.ts            ← library build; see "Vite build recipe" below
```

### `package.json` exports

```jsonc
{
  "name": "@your-scope/your-package",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/types/index.d.ts",
      "default": "./dist/index.js"
    },
    "./granular-provider": {
      "types": "./dist/types/granular-provider/index.d.ts",
      "default": "./dist/granular-provider/index.js"
    },
    "./granular-provider/node": {
      "types": "./dist/types/granular-provider/node.d.ts",
      "default": "./dist/granular-provider/node.js"
    },
    "./components/*": {
      "types": "./dist/types/components/*/index.d.ts",
      "default": "./dist/components/*/index.js"
    }
  },
  "peerDependencies": {
    "@feugene/unocss-preset-granular": "^0.10.0",
    "vue": "^3"
  }
}
```

A **composite** provider (one that declares `dependencies` on components from
another provider) must add that donor to its own `peerDependencies` — the
application is responsible for installing both.

## Define a component: `config.ts`

```ts
// packages/<your-package>/src/components/MyButton/config.ts
import { defineGranularComponent } from '@feugene/unocss-preset-granular/contract'

export const buttonConfig = defineGranularComponent(import.meta.url, {
  name: 'MyButton',

  // ONLY classes that can't be statically extracted from the template
  // (dynamic, computed, template‑literal, attr(...)). Static classes are
  // picked up by UnoCSS via content.filesystem — don't duplicate them.
  safelist: [
    /^my-button--/,           // regex is fine
    'my-button--disabled',
  ],

  // CSS that ships with the component and should always be present as a
  // preflight in the final CSS (independent of template usage).
  cssFiles: ['./styles.css'],

  dependencies: [
    // same provider, short form:
    'MyIcon',

    // another provider, qualified form:
    '@feugene/simple-package:XTestStyled',

    // object form — multiple names from one provider:
    { provider: '@feugene/simple-package', components: ['XTest1', 'XTestStyled'] },
  ],

})
```

Notes:

- The **first argument** is `import.meta.url` of the component's `config.ts`.
  The preset uses it to resolve `cssFiles[i]` via `new URL(..., import.meta.url)`.
- `safelist` entries may be `string` or `RegExp`.
- Keep `safelist` minimal. If you find yourself listing `p-5`, `text-lg` etc.,
  you probably just need the component to be scannable (→
  [Component scanning](./component-scanning.md)).

## Define the provider: `granular-provider/index.ts`

```ts
import { defineGranularProvider, resolvePackageBaseUrl } from '@feugene/unocss-preset-granular/contract'
import { buttonConfig } from '../components/MyButton/config'
import { iconConfig } from '../components/MyIcon/config'

export default defineGranularProvider({
  id: '@your-scope/your-package',
  contractVersion: 1,

  // URL of the package assets root. The /node layer resolves
  // `cssFileAssetNames` (the cssFiles fallback) and `components/<Name>/`
  // scan dirs against it — so it must point at the root of THIS build's
  // layout, whether that is src/ or dist/.
  //
  // `resolvePackageBaseUrl(importMetaUrl, levelsUp = 1)` goes one directory up
  // from the calling module. Do NOT write `new URL('..', import.meta.url)`:
  // rolldown recognises that exact literal and replaces it with a data: URL
  // at build time, which silently collapses the scan to nothing.
  packageBaseUrl: resolvePackageBaseUrl(import.meta.url),

  components: [buttonConfig, iconConfig],

  theme: {
    baseCssUrl:   new URL('../styles/base.css',   import.meta.url).href,
    tokensCssUrl: new URL('../styles/tokens.css', import.meta.url).href,
    themes: {
      light: new URL('../styles/themes/light.css', import.meta.url).href,
      dark:  new URL('../styles/themes/dark.css',  import.meta.url).href,
    },
    // Activated when the app does not pass `themes.names`. Declare only the
    // themes this provider actually ships — see themes-and-tokens.md.
    defaultThemes: ['light'],
  },

  unocss: {
    // optional: rules / variants / preflights needed by the package's components
    // rules: [[/^my-grad$/, () => ({ 'background-image': '...' })]],
  },
})
```

For the optional node entry (`granular-provider/node.ts`) see
[Themes and tokens → `tokenDefinitionsFromCss*`](./themes-and-tokens.md).

## Vite build recipe — `chunkFileNames`

> ⚠️ **Applies to provider packages only**, not to end applications. End
> apps consume the provider's prebuilt `dist/` and do **not** need any
> `chunkFileNames` configuration of their own.

This is **critical** for libraries that ship components as Vue SFCs and want
them to be scannable by the preset. By default `@vitejs/plugin-vue` emits
SFC chunks into a flat `dist/chunks/` folder, far from the component's
declared dir. The preset's scan globs point at the component dir, so those
chunks don't get scanned — and classes like `p-5` never reach the final CSS.

The fix is to route **SFC chunks into the component's own sub‑folder**. The
logic is identical for every provider, so the preset ships a ready‑made
helper `granularChunkFileNames` under the `./vite` subpath:

```ts
// packages/<your-package>/vite.config.ts
import { defineConfig } from 'vite'
import Vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'
import { granularAssetFileNames, granularChunkFileNames } from '@feugene/unocss-preset-granular/vite'

export default defineConfig({
  plugins: [Vue()],
  build: {
    lib: {
      entry: {
        'index':                          resolve(__dirname, 'src/index.ts'),
        'granular-provider/index':        resolve(__dirname, 'src/granular-provider/index.ts'),
        'granular-provider/node':         resolve(__dirname, 'src/granular-provider/node.ts'),
        'components/MyButton/index':      resolve(__dirname, 'src/components/MyButton/index.ts'),
        'components/MyIcon/index':        resolve(__dirname, 'src/components/MyIcon/index.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: { // or rolldownOptions if Vite uses rolldown
      external: ['vue', /^@feugene\//],
      output: {
        entryFileNames: '[name].js',
        // Component SFC chunks → `components/<Name>/chunks/`,
        // everything else stays in flat `chunks/`.
        chunkFileNames: granularChunkFileNames(),
        // Component CSS → `components/<Name>/styles.css` — the path
        // `defineGranularComponent` records in `styleAssetFileName` and the
        // one the node layer falls back to when the package ships `dist/`
        // only. Requires `build.cssCodeSplit: true` so that each component
        // gets its own asset instead of one combined library CSS.
        assetFileNames: granularAssetFileNames({
          components: ['MyButton', 'MyIcon'],
        }),
      },
    },
  },
})
```

Why it matters: without this, `dist/components/MyButton/index.js` is only a
re‑export; the real template markup (with `class="p-5"` literals) lives in
`dist/chunks/*.js`. Moving SFC chunks into `components/<Name>/chunks/` keeps
them inside the scan directory of the selected component.

### Placing declared CSS in `dist`

`assetFileNames` covers the CSS the **bundler emits** (a component's compiled
SFC styles). It does nothing for CSS your config merely *declares* — a
`tokenDefinitionsRef` written as a plain string, or `cssFiles`. Those have an
`assetName` in the descriptor, and the node layer falls back to it when the
package ships `dist/` only — but nothing puts a file there, so the consumer
gets `ENOENT`.

`granularCssAssetsPlugin` closes that gap. It builds its plan from the
descriptors themselves — for every reference it copies the source to exactly the
`assetName` the `define*` helper recorded — so it cannot drift from the contract:

```ts
import { granularCssAssetsPlugin } from '@feugene/unocss-preset-granular/vite'
import { myButtonConfig } from './src/components/MyButton/config'

export default defineConfig({
  plugins: [
    vue(),
    granularCssAssetsPlugin({ components: [myButtonConfig] }),
    // or, to sweep a whole provider (its theme refs + every component):
    // granularCssAssetsPlugin({ providers: [myProvider] }),
  ],
})
```

A reference whose source is missing fails the build (`GranularCssAssetError`);
pass `onMissing: 'warn'` to downgrade that. References already inlined by the
bundler as `data:` URLs are skipped — there is nothing to copy.

One asymmetry to know: `defineGranularProvider` is an identity function, so
package‑wide `theme.tokenDefinitionsRef` entries get **no** `assetName`. The
plugin reports them rather than skipping them quietly — declare those in the
`new URL(..., import.meta.url)` form.

### `granularChunkFileNames` options

The helper is a pure function (no Vite/rolldown/node deps) and defaults to
the standard `src/components/<Name>/<Name>.vue` layout. Override only if
your layout differs:

```ts
granularChunkFileNames({
  // regex capturing the component directory name in group 1
  componentModuleRegex: /\/src\/ui\/([^/]+)\/[^/]+\.vue(?:$|\?)/,
  // pattern for component chunks; `<name>` is substituted
  componentChunkPattern: 'ui/<name>/chunks/[name]-[hash].js',
  // pattern for all non‑component (shared) chunks
  fallbackChunkPattern: 'chunks/[name]-[hash].js',
})
```

⚠️ Don't let non‑component chunks (like `granular-provider` or shared
config chunks) land in a component folder — doing so breaks runtime
`packageBaseUrl` resolution. The helper only triggers the rewrite when a
chunk's module set actually contains a component's `*.vue` file.

### Component groups & shared SFCs

When two or more entry‑components import a common SFC, Rollup deduplicates
it into a single shared chunk. That chunk would normally land in flat
`dist/chunks/` and **not** be scanned. To keep utility classes from such
shared SFCs in the final CSS, place them under
`src/components/<group>/shared/<File>.vue` and declare the same `group`
on every entry‑component of that group:

```ts
// src/components/transaction-details/FtExpenseModal/config.ts
defineGranularComponent(import.meta.url, {
  name: 'FtExpenseModal',
  group: 'transaction-details',
  safelist: [],
})

// src/components/transaction-details/shared/TransactionModalHeader.vue
// — imported by FtExpenseModal, FtIncomeModal, FtTransferModal
```

`granularChunkFileNames()` recognises the `<group>/shared/<File>.vue`
layout and routes shared SFC chunks to
`dist/groups/<group>/shared/[name]-[hash].js`. The end‑app preset, given
a selected component with `group: '<group>'`, additionally scans
`<packageBaseUrl>/groups/<group>/shared/` (deduplicated to a single scan
per group). See [component-scanning → Component groups](./component-scanning.md#component-groups-shared-sfcs-across-entry-components).

You can override the regex/pattern for non‑standard layouts:

```ts
granularChunkFileNames({
  sharedModuleRegex: /\/src\/widgets\/(.+)\/_shared\/[^/]+\.vue(?:$|\?)/,
  sharedChunkPattern: 'groups/<group>/shared/[name]-[hash].js',
})
```

## Keeping the registries in sync — `/codegen`

A provider lists its components in several places at once: the root barrel, the
`exports` subpaths, the build entries, the provider's own registry — and a
companion package adds its auto-import resolver whitelist and the list feeding
`granularAssetFileNames`. Miss one and nothing fails to build: tree shaking, a
subpath import or the UnoCSS class scan breaks on its own, silently.

`@feugene/unocss-preset-granular/codegen` derives all of them from the file
system. A directory counts as a public component when it has both `index.ts`
and `config.ts`.

```js
// scripts/generate-registry.mjs
import { fileURLToPath } from 'node:url'
import { codegenTargets, runRegistryCodegen } from '@feugene/unocss-preset-granular/codegen'

const { components, stale } = await runRegistryCodegen({
  packageDir: fileURLToPath(new URL('..', import.meta.url)),
  check: process.argv.includes('--check'),
  targets: [
    codegenTargets.barrel(),           // src/index.ts
    codegenTargets.viteEntries(),      // vite.config.ts
    codegenTargets.packageExports(),   // package.json#exports
    ...codegenTargets.providerRegistry(), // granular-provider/shared.ts
  ],
})
```

In TypeScript files only the marked block is rewritten — the rest of the file
is none of the generator's business, and the block's own indentation is kept:

```ts
// <granularity:components>
export * from './components/GrAlert'
// </granularity:components>
```

`package.json` cannot carry markers, so the contiguous run of component keys is
replaced in place, leaving every other export where it was. A component key is exactly
`./components/<Name>` — one segment, no wildcard. A deeper subpath of the same
component (`./components/GrAlert/styles.css`) or a pattern
(`./components/*/styles.css`) belongs to the package, not to the generator: the
run leaves it alone, the way it leaves `.` and `./contract` alone. Such keys end
up after the run once it is rewritten, and stay there on every later run.

### Parts of composite components

`GrTimelineItem`, `GrListItem`, menu items live in the parent's directory and are
not public components: they have no `index.ts` and no `config.ts` of their own,
and their code ends up in the parent's chunk anyway. They need no entry of their
own — but they do need a subpath: without one
`@feugene/kit/components/GrTimelineItem` fails with
`ERR_PACKAGE_PATH_NOT_EXPORTED`, so granular imports do not reach these names at
all, even though a template spells them like any other component.

`packageExports({ subcomponents: true })` puts aliases next to the components:
the key is the part's own, the module is the parent's. A part is recognised by
the parent's barrel (`export { default as GrX } from './GrX.vue'`), so a
re-export under a different name never becomes an alias — the subpath would point
at a module that holds no such file.

The part may sit in a subdirectory of the parent (`parts/GrTimelineItem.vue`) and
be quoted either way — the module is the parent's regardless. The name must carry
the package prefix: a barrel re-exports internals too (`TableCell`), and the
generator does not widen the package's public API on its own. A name already taken
— by a component or by another parent's part — is a `subcomponent-name-clash`
error rather than a silently chosen winner: one subpath cannot serve two modules.

The alias resolves to the parent's module, whose default export is the parent, so
a part is imported by name: `import { GrTimelineItem } from
'@feugene/kit/components/GrTimelineItem'`.

Off by default: a provider's `package.json` must not change from a preset upgrade
alone.

Anything a provider has beyond the four standard registries goes through
`codegenTargets.markedBlock({ file, lines })` — the resolver whitelist and the
`granularAssetFileNames` list are exactly that shape. `prefix` and
`configExportName` are options too, so a package whose components are not
`Gr*` is covered without a second generator.

Run `--check` from a test: it writes nothing and reports which files drifted.
That is the gate — the lists stay synchronised by machine, not by attention.

A package with no components yet is a legitimate first run: with nothing to
insert and no existing subpath to anchor to, the generator leaves `exports`
alone. What it will not do is treat a *missing* components directory as zero
components — a typo in the path would then quietly strip every registry.

## What NOT to do

Six mistakes that build cleanly and break only at runtime — or only in the
published package:

**1. Importing `/node` from a component's `config.ts`.** That file ends up in
`granular-provider/index.ts` — your **browser** export — so the import drags
`node:fs` into the client bundle. Nothing fails at build time.

If a component needs tokens parsed out of CSS, **declare a reference instead of
reading the file yourself** — `tokenDefinitionsRef` is plain data, and the
preset's node layer resolves it while the app's config loads:

```ts
// components/XTokenized/config.ts — no /node import, no second file
import { defineGranularComponent } from '@feugene/unocss-preset-granular/contract'

export const xTokenizedConfig = defineGranularComponent(import.meta.url, {
  name: 'XTokenized',
  tokenDefinitionsRef: {
    // A literal `new URL(..., import.meta.url)` is what makes the bundler
    // emit (or inline) the CSS — see "Two forms of a reference" below.
    light: new URL('./themes/light.css', import.meta.url).href,
    dark: { url: new URL('./themes/dark.css', import.meta.url).href, as: '.dark' },
  },
})
```

See [Themes and tokens →
`tokenDefinitionsRef`](./themes-and-tokens.md#tokendefinitionsref--references-instead-of-fs-access)
for both forms of a reference and what the node layer does with them.

<details>
<summary>Before <code>tokenDefinitionsRef</code>: the two-file workaround</summary>

The older way was to split the config in two — still valid if you need
arbitrary node-side computation, not just parsing a CSS file:

```ts
// components/XTokenized/config.ts — literals only, browser‑safe
import { defineGranularComponent } from '@feugene/unocss-preset-granular/contract'

export const xTokenizedConfig = defineGranularComponent(import.meta.url, {
  name: 'XTokenized',
})
```

```ts
// components/XTokenized/config.node.ts — may touch the file system
import { tokenDefinitionsFromCssSync } from '@feugene/unocss-preset-granular/node'
import { xTokenizedConfig } from './config'

const lightUrl = new URL('./themes/light.css', import.meta.url).href

export const xTokenizedNodeConfig = {
  ...xTokenizedConfig,
  tokenDefinitions: {
    light: tokenDefinitionsFromCssSync(lightUrl, { selector: ':root' }),
  },
}
```

Then expose a factory from the browser entry and reuse it in the node entry —
so the two variants can never drift apart in `id` or `packageBaseUrl`:

```ts
// granular-provider/index.ts
export const PACKAGE_BASE_URL = resolvePackageBaseUrl(import.meta.url)
export const browserComponents = [xTokenizedConfig /* , ... */]

export function createMyProvider(components: typeof browserComponents) {
  return defineGranularProvider({
    id: '@your-scope/your-package',
    contractVersion: 1,
    packageBaseUrl: PACKAGE_BASE_URL,
    components,
  })
}

export default createMyProvider(browserComponents)
```

```ts
// granular-provider/node.ts
import { xTokenizedNodeConfig } from '../components/XTokenized/config.node'
import { browserComponents, createMyProvider } from './index'

export default createMyProvider(
  browserComponents.map(c => (c.name === 'XTokenized' ? xTokenizedNodeConfig : c)),
)
```

</details>

**2. Importing a donor's `/node` entry from your browser entry.** Same leak,
one level up: `granular-provider/index.ts` must import
`@your-donor/pkg/granular-provider`, and only `granular-provider/node.ts` may
import `@your-donor/pkg/granular-provider/node`.

Verify on the built bundle, not on the sources:

```bash
grep -rn "unocss-preset-granular/node" dist/granular-provider.js dist/chunks/*.js
# must print nothing
```

**3. Writing token keys with `--`.** `tokens: { brand: '#fff' }`, never
`{ '--brand': '#fff' }` — the generator adds the prefix and you would get
`----brand`.

**4. Listing a theme in `defaultThemes` that you don't actually supply.**
`defaultThemes` doesn't activate a theme for *your* components — it activates
it for the **whole build**. Declare `dark` without shipping either
`themes.dark` or `tokenDefinitions.dark`, and every other provider's components
render under a theme nobody gave them tokens for. Declare only what you supply
(`granular doctor` flags the rest as `default-theme-without-source`).

**5. Letting `styleAssetFileName` and `cssFileAssetNames` describe different
layouts.** The preset reads only `cssFileAssetNames`; your bundler's
`assetFileNames` follows only `styleAssetFileName`. While you develop in a
monorepo the CSS is found at its `cssFiles` path and the fallback never runs,
so the two can disagree indefinitely. It breaks in the **published** package,
where `src/` is gone and the fallback is the only path left — as an `ENOENT`
in someone else's build. Emit both from `defineGranularComponent` and don't
hand-write either.

**6. Putting a dependency's classes in your own `safelist`.** It looks like it
works: the classes appear in the CSS. But `dependencies` is what pulls in the
other component's `cssFiles` **and** its scan directory, and a `safelist` entry
pulls in neither — you get the utility classes and lose the component's own
stylesheet. Declare the edge in `dependencies`; the preset collects the
transitive `safelist` and CSS for you.

**7. Letting `dependencies` drift from what you ship.** Your bundler never reads
`dependencies`, so forgetting an edge costs you nothing at build time and costs
your consumer a colourless nested component. Run `granular doctor` — it compares
the declared graph against the imports actually present in your build output and
reports every gap as `undeclared-dependency`. Always **with
`components: 'all'`**: only selected components serve as sources, so on an app's
configuration you would be checking that selection's closure rather than your
package. In CI, `--strict`. The limits of the check are listed in
[cli.md](./cli.md).

## Rules recap

- `safelist` → **only** component's own dynamic classes.
- `dependencies` → components your built code **actually imports**
  (same‑provider short name, `providerId:Name`, or object form).
- `cssFiles` → component‑local CSS that must always ship as preflight.
- `packageBaseUrl` → must point to the **package directory**, not a module.
- `packageBaseUrl` comes from `resolvePackageBaseUrl(import.meta.url)`, called
  from the **entry file**: `new URL('..', import.meta.url)` is transformed into a
  `data:` URL at build time, and from a shared module the base drifts a level —
  the bundler decides its depth.
- The donor provider of any cross‑provider `dependencies` must be in
  `peerDependencies`.

## Publishing checklist

- [ ] `dist/` contains `granular-provider/index.js` (+ `node.js` if used).
- [ ] `dist/components/<Name>/index.js` exists for every component and
      `dist/components/<Name>/chunks/*.js` contain the real SFC code.
- [ ] Every string-form `tokenDefinitionsRef` / `cssFiles` entry has a real
      file at its `assetName` in `dist` (that is what `granularCssAssetsPlugin` is for).
- [ ] `package.json.exports` maps all those subpaths.
- [ ] `peerDependencies` lists `@feugene/unocss-preset-granular`, `vue`, and
      every donor provider you declare as `dependencies`.
- [ ] No references to `data:` URLs in runtime code (sanity check of
      `packageBaseUrl`).
- [ ] Smoke test: install the package in a fresh app, add it to `providers`,
      pick one component, run `vite build`, check that its classes land in
      the final CSS without adding `safelist`.
