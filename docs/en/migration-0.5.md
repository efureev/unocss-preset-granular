# Migrating `0.4.0` → `0.5.0`

What changed between `0.4.0` and `0.5.0`, which of it breaks silently and in
what order to fix it. The document targets two kinds of reader: the application
author (`uno.config.ts`) and the provider package author.

> 🇷🇺 Русская версия: [`../ru/migration-0.5.md`](../ru/migration-0.5.md).

The theme of the release: most changes turn silent breakage into loud breakage.
Where `0.4.0` printed a `console.warn` or emitted empty CSS, `0.5.0` throws a
typed error naming the provider and the component. If your build fails right
after the upgrade, it was almost certainly already broken before it.

## At a glance

| Change | Who is affected | Action |
|---|---|---|
| `layer` defaults to `'granular'`, order `-50` | apps | check the cascade, use `layer: null` if needed |
| `scan.extensions` extends the default list | apps | `replaceExtensions: true` for the old meaning |
| Provider validated at registration | providers | `packageBaseUrl` must end with `/` |
| `resolveComponentScanDirs` → `{ dirs, skipped }` | tooling | `.dirs` replaces the old array |
| Nested CSS blocks in tokens are an error | providers | flatten the blocks |
| `tokenDefinitionsRef` | providers | drop `config.node.ts` and the `/node` import |
| `./runtime` entry + `granularThemesPlugin` | apps | theme switching without a hand-written map |
| `themes.define` | apps | application-owned themes |
| CLI commands `explain` / `why-css` | everyone | debugging instead of reading CSS by eye |

## Breaking changes

### 1. The default layer is `granular`

`layer?: string` became `layer?: string | null`. `undefined` no longer means
"no layer": the preset puts everything it emits into the `granular` layer and
**declares its order itself** — `-50`, i.e. after `preflights` and before
`shortcuts`/`default`.

That way a utility (`p-5`) overrides component CSS, not the other way round. In
`0.4.0` an app without a layer got unlayered preflights, and an app that set a
layer without declaring `layers` in `defineConfig` got order `0` — a tie with
`default` broken alphabetically, so `granular` landed AFTER the utilities.

```ts
// restore the "no layer at all" behaviour
presetGranularNode({ providers, components: 'all', layer: null })
```

The apps in `apps/app-1..4` already passed `layer: 'granular'` explicitly — for
them only the declared order changes.

### 2. `scan.extensions` now EXTENDS instead of replacing

In `0.4.0` `extensions: ['mdx']` meant "scan `.mdx` only" and silently disabled
scanning of `.vue`/`.js`. It now means "the default extensions plus `.mdx`".

```ts
// the old meaning (replace the whole list)
scan: { extensions: ['mdx'], replaceExtensions: true }
```

The default list is `js`, `mjs`, `cjs`, `ts`, `mts`, `cts`, `jsx`, `tsx`, `vue`;
the effective one is computed by `resolveScanExtensions()` from `/node`.

### 3. Providers are validated at registration time

`expandProviders` now throws `InvalidProviderError` (`reason`: `invalid-id`,
`invalid-package-base-url`, `package-base-url-not-a-directory`,
`invalid-components`, `css-files-length-mismatch`).

The most common case is a `packageBaseUrl` without a trailing `/`: `new URL()`
drops the last segment, so the scan silently moved one level up. In `0.4.0`
that surfaced as empty CSS; now it is an error while the config loads.

### 4. `resolveComponentScanDirs` returns an object

It used to return `ResolvedScanDir[]`; it now returns `ScanDirsInspection` —
`{ dirs, skipped }`. `skipped` lists the components that dropped out of the
scan together with the reason (`missing-dir`, `missing-entry`,
`invalid-base-url`).

Direct callers (your own scripts, wrappers) append `.dirs`. Applications rarely
call it at all — they go through `granularContent`.

### 5. The CSS token parser accepts flat blocks only

`tokenDefinitionsFromCss*` and `parseCssCustomPropertyBlocks*` now parse CSS
recursively and no longer pretend a nested block is a top-level one. Nesting
(CSS Nesting) and blocks inside `@media`/`@supports` are reported as skipped:
an error in strict mode, a single `warn` otherwise.

```css
/* 0.4.0 — "worked" by accident */
.dark { :root { --x: yellow; } }

/* now */
.dark { --x: yellow; }
```

Fixed along the way: the semicolon after the last declaration in a block is now
optional, as CSS allows.

### 6. `presetGranularNode` always emits `content`

Previously, with empty globs (`scan.enabled: false`) the preset's `content`
section fell back to the base one and `pipeline.include` was lost — without it
the extractor never looked into the `.js` files inside component directories.
`content` is now always returned. If you worked around this with your own
`content` in `defineConfig`, the workaround can go.

### 7. CSS read failures are now named errors

Instead of a bare `ENOENT` with an absolute path you get `GranularCssReadError`
carrying the provider, the section (`base/tokens` / `theme` / `component`) and
the subject. Catch it by class if you used to match on the message text.

### 8. Publishing: `dist/package.json` is no longer generated

The package is published from the directory root (`files: ["dist"]`), and the
nested manifest with its own `exports` map misled bundlers. Imports through the
documented entry points are unaffected; deep imports such as
`@feugene/unocss-preset-granular/dist/...` were never supported.

### 9. Licence and environment

The licence is `MIT` (it was `SEE LICENSE IN LICENSE`), and `LICENSE` files were
added to the repository. `typescript` in devDependencies is `^6.0.3`.

## What is new

### `tokenDefinitionsRef` — theme tokens by reference to CSS

The main reason for a provider author to upgrade. To ship structural tokens a
component used to call `tokenDefinitionsFromCssSync` from `/node` — and that
import, once it reached the browser `config.ts`, dragged `node:fs` into the
client bundle (without failing the build). The workaround was a paired
`config.node.ts`.

A reference is plain data now, and the preset's node layer reads the file:

```ts
export const xTokenizedConfig = defineGranularComponent(import.meta.url, {
  name: 'XTokenized',
  tokenDefinitionsRef: {
    light: new URL('./themes/light.css', import.meta.url).href,
    dark: { url: new URL('./themes/dark.css', import.meta.url).href, as: '.dark, [data-theme="dark"]' },
  },
})
```

`GranularThemeTokenRef` fields: `url`, `selector` (what to pick, `:root` by
default), `as` (what to emit it under), `strict` (`true` by default) and
`assetName` (the fallback for a published `dist` without sources — filled in by
the helpers). The provider-wide counterpart is `theme.tokenDefinitionsRef`.
Literal `tokenDefinitions` for the same theme win over a reference.

After the switch `granular-provider/node.ts` usually collapses to
`export * from './index'` — see [Authoring providers](./authoring-providers.md).

### `resolvePackageBaseUrl`

Replaces the hand-written `import.meta.url` slice copied into every provider:

```ts
import { resolvePackageBaseUrl } from '@feugene/unocss-preset-granular/contract'

export const PACKAGE_BASE_URL = resolvePackageBaseUrl(import.meta.url)
```

The second argument, `levelsUp` (`1` by default), is how many levels to climb
from the module to the package layout root. A literal `new URL('..',
import.meta.url)` will not do: Vite and rolldown recognise exactly that literal
and replace it with a `data:` URL, after which the scan dirs collapse to nothing.

### `granularAssetFileNames` in `/vite`

The counterpart of `granularChunkFileNames`: it puts a component's CSS where the
contract expects it — `components/<Name>/styles.css`. By default Vite would emit
it flat (`dist/XTest1.css`) and the CSS read fallback in the published package
would hit `ENOENT`.

```ts
export default defineConfig({
  build: {
    rolldownOptions: {
      output: {
        chunkFileNames: granularChunkFileNames(),
        assetFileNames: granularAssetFileNames({ components: COMPONENT_NAMES }),
      },
    },
  },
})
```

### Application-owned themes: `themes.define`

The set of themes belongs to the application, not to the providers.
`themes.define` lets it declare its own themes (`extends` from another theme's
effective tokens, its own `tokens`/`tokensRef`, `label`, `colorScheme`) and skip
`light` and `dark` entirely, even if a provider ships them.

```ts
themes: {
  define: {
    emerald: { extends: 'light', tokens: { 'app-bg': '#052e1f' }, label: 'Emerald', colorScheme: 'dark' },
  },
}
```

Important: `define` without `names` means "the build's theme list = the keys of
`define`"; provider `defaultThemes` are not consulted in that case. Token
precedence: providers → components → `define` → `tokenOverrides`. Details in
[Themes and tokens](./themes-and-tokens.md).

### Runtime theme switching: `./runtime` + `granularThemesPlugin`

The fifth entry point, `./runtime`, is types, a pure selector parser and a DOM
controller — no FS, no UnoCSS, no dependencies at all. Its counterpart is the
Vite plugin from `/node` that serves the `virtual:granular-themes` manifest
built from the SAME resolution the CSS is emitted from, so they cannot drift.

```ts
// vite.config.ts
plugins: [vue(), UnoCSS({ configFile }), granularThemesPlugin(granularOptions)]

// src/theme.ts
import manifest from 'virtual:granular-themes'
import { createThemeController } from '@feugene/unocss-preset-granular/runtime'

export const themes = createThemeController(manifest)
```

The controller exposes `list()`, `get()`, `set()`, `cycle()`, `subscribe()` and
`entry()`; the options are `target`, `storage` (`localStorage` by default,
`null` to not remember), `storageKey`, `initial` (`'auto'` — stored choice, then
the system scheme), `systemThemes`, `prefersDark`. Working examples:
`apps/app-5` (provider themes) and `apps/app-6` (application themes).

### CLI: `explain`, `why-css`, `--json`, `--strict`

`granular` is no longer just `doctor`:

```bash
granular doctor  ./granular.options.mjs --json --strict
granular explain ./granular.options.mjs '@feugene/simple-package:XTokenized'
granular why-css ./granular.options.mjs 'rounded-3xl'
```

`explain` shows why a component is in the build (the chain from the selection
root, reverse dependencies, its contribution to safelist/CSS/tokens); `why-css`
shows which component pulled a class into the emitted CSS. Flags are accepted in
any position. Programmatic access: `granularExplain`/`granularWhyCss` and the
`format*Report` functions from `/node`. Full reference: [`granular` CLI](./cli.md).

### Diagnostics instead of silence

`doctor` gained structured `diagnostics` (`level`, `code`) plus the `ok` field
(no `error`) and `clean` (nothing at all, which is what `--strict` checks); the
theme resolver gained `warnings`: `default-theme-without-source`,
`partial-theme`, `multiple-default-themes`, `theme-extends-unresolved`,
`theme-extends-cycle`. Scan dirs are computed once and identically for the build
and for doctor — doctor used to report a different set than the build used.

## Migration plan

For an application:

1. Bump `@feugene/unocss-preset-granular` to `^0.5.0` and rebuild the providers
   (`yarn build:all` — build order is part of the contract).
2. Check the cascade: the `granular` layer now declares order `-50`. Your own
   order goes into `layers` in `defineConfig`; opting out is `layer: null`.
3. If you set `scan.extensions`, decide whether it extends or replaces.
4. Run `granular doctor ./granular.options.mjs --strict` and work through the
   warnings: nearly all of them describe defects that existed in `0.4.0` too.
5. Optionally move the theme switcher onto `./runtime`.

For a provider:

1. Replace the hand-written `packageBaseUrl` with
   `resolvePackageBaseUrl(import.meta.url)` and make sure it ends with `/`.
2. Move `tokenDefinitions` to `tokenDefinitionsRef` and delete `/node` imports
   from browser `config.ts` files (and the paired `config.node.ts`).
3. Flatten the CSS token blocks — nesting is no longer parsed.
4. Add `assetFileNames: granularAssetFileNames({ components })` to
   `vite.config.ts`.
5. Check that `cssFiles` and `cssFileAssetNames` have equal length — that is an
   error now, not a silently disabled fallback.

## Verifying

```bash
yarn build:all
yarn test:all
```

`test:all` runs the preset tests, the docs parity check, a build of every package
and application, and `verify:apps`: a comparison of the built CSS against each
app's `expected-css.mjs`. A successful build proves nothing on its own — it stays
green even when a component's classes silently vanished from the CSS. If
something drifted, start from [Troubleshooting](./troubleshooting.md).
