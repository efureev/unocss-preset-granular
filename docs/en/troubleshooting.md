# Troubleshooting & recipes

A living list of the questions that come up most often.

## "`p-5` from a provider component doesn't appear in the final CSS"

Likely causes, in order of probability:

1. **No `granularContent(options)` in `uno.config.ts`.** UnoCSS's Vite
   plugin ignores preset‑level `content.*`. Add:

   ```ts
   content: granularContent(granularOptions),
   ```

   See [Component scanning](./component-scanning.md).

2. **The provider was built with flat `dist/chunks/`.** The SFC body isn't
   under the component's scan dir. Apply the `chunkFileNames` recipe in
   [Authoring providers](./authoring-providers.md#vite-build-recipe--chunkfilenames).

3. **`packageBaseUrl` of the provider was built as
   `new URL('..', import.meta.url)`.** Rolldown replaces that literal with
   a `data:` URL at build time — scan globs resolve to nothing. Switch to
   runtime string construction (see `authoring-providers.md`).

4. **The class is dynamic, not static** (e.g. `` :class="`p-${n}`" ``).
   Static extraction can't see it. Either refactor to static, or add the
   specific classes to `safelist`.

## "Adding `'all'` pulls in way too much CSS"

That's by design — `components: 'all'` explicitly disables granular
selection. Use it only for demos / playgrounds. In production list the
exact components you render.

## "HMR doesn't pick up a new class from a provider source"

`content.filesystem` is watcher‑backed, but only for directories listed in
the computed globs. If you just added a new component to a provider and
didn't restart the dev server, the glob list is still the old one. Restart
`vite dev`. Iterating on classes inside an already‑selected component
works out of the box.

## "I have `@apply` inside a provider's `styles.css` and it's not expanded"

`cssFiles` are loaded as UnoCSS **preflights**, which by default bypass the
`transformer-directives` transformer. Two fixes: (1) set
`presetGranularNode({ expandDirectives: true })` so the preset expands
`@apply` / `@screen` / `theme()` in the injected CSS itself; or (2) move the
stylesheet into an SFC `<style src="./styles.css">` and enable
`transformerDirectives()` in `uno.config.ts`. See the recipe in
[Themes and tokens → `@apply` inside per‑component `styles.css`](./themes-and-tokens.md#apply-inside-per-component-stylescss).

## "Arbitrary values like `bg-[var(--card)]` don't show up"

They require `@unocss/preset-wind4` (or a preset that enables arbitrary
values). Make sure `presetMini()`, `presetWind4()` (or equivalent) is in the `presets`
array **before** `presetGranularNode(...)`.

## "Cross‑provider `dependencies` throw at config load"

`ProviderNotRegisteredError` means your composite provider references
`@feugene/other:DsIcon`, but `@feugene/other` isn't in the `providers`
array of the *app's* `uno.config.ts`. Add it. Also make sure your
composite declares it in `peerDependencies`.

## "Two providers share a component name"

Names are unique **per provider**, not globally. Always use the qualified
form (`providerId:Name`) or the object form (`{ provider, names }`) in
`options.components` and in cross‑provider `dependencies`.

## "TypeScript can't find `@feugene/unocss-preset-granular/contract`"

Ensure your package manager installed the preset (`@feugene/unocss-preset-granular`)
as a direct dependency of the app / provider you're writing the config in,
and that your `tsconfig.json` uses `moduleResolution: 'bundler'` (or
`nodenext`) so TS honours `package.json.exports`.

## "Monorepo dev: `vite dev` sees old provider code after a rebuild"

Vite caches by module URL. If the provider is linked via workspace and the
URL didn't change, a full rebuild of the app (or a hard dev‑server
restart) fixes it. For pure CSS changes it's usually enough to save the
CSS file — the watcher picks it up and the preflight regenerates.

## `granular doctor` — diagnostics

The preset ships a `granular` CLI whose `doctor` subcommand prints a full
diagnostic: resolved providers, the transitive selected‑component graph
(deps → dependents), theme token blocks per selector, **token conflicts**
across layers (provider → component → app override), the final scan globs,
and any **missing `components/<Name>/` directories** (layout‑contract
violations). It exits `1` if any violation is found — handy in CI.

Point it at a small module that exports your granular options:

```js
// granular.options.mjs
import provider from '@your/pkg/granular-provider/node'
export default { providers: [provider], components: 'all' }
```

```bash
npx granular doctor ./granular.options.mjs
```

The same report is available programmatically (e.g. from a Vite plugin or a
one‑off script):

```ts
import { granularDoctor, formatDoctorReport } from '@feugene/unocss-preset-granular/node'

const report = granularDoctor(options)   // structured DoctorReport
console.log(formatDoctorReport(report))  // human‑readable text
if (!report.ok) process.exit(1)
```

## Getting more insight

- The test suite of the preset
  (`packages/unocss-preset-granular/src/__tests__`) is the authoritative
  living spec — if a behaviour is ambiguous in the docs, the tests win.
- To inspect what the preset resolved, call `defineGranular(options)` and
  read `.resolution()` (providers, selected components, `themes.tokenRegistry`)
  or dump `.nodeCss()` / `getGranularThemeCss(options)` — the layout contract
  violations are additionally surfaced via `console.warn` (or thrown with
  `scan: { strict: true }`).
- For runtime logs, set `DEBUG=granular:*` (or a specific namespace —
  `granular:resolve` for the resolved graph, `granular:scan` for scan dirs).
  Output goes to `stderr`; disabled entirely when `DEBUG` is unset.
