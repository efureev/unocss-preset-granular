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

`cssFiles` are loaded as UnoCSS **preflights**, which bypass the
`transformer-directives` transformer. See the recipe in
[Themes and tokens → `@apply` inside per‑component `styles.css`](./themes-and-tokens.md#apply-inside-per-component-stylescss).
TL;DR — move the stylesheet into an SFC `<style src="./styles.css">` and
enable `transformerDirectives()` in `uno.config.ts`.

## "Arbitrary values like `bg-[var(--card)]` don't show up"

They require `@unocss/preset-wind4` (or a preset that enables arbitrary
values). Make sure `presetWind4()` (or equivalent) is in the `presets`
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

## Getting more insight

- The test suite of the preset
  (`packages/unocss-preset-granular/src/__tests__`) is the authoritative
  living spec — if a behaviour is ambiguous in the docs, the tests win.
- For runtime debug prints, run your build with `DEBUG=granular:*`
  (where supported) — the preset logs via a `debug`‑style namespace.
