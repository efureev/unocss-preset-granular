# Component scanning (`content.filesystem`)

> See also: [Usage in apps](./usage-in-apps.md),
> [Authoring providers](./authoring-providers.md).

This is the mechanism that lets UnoCSS pick up statically‑written classes
like `class="p-5"` from inside a provider's component **without** adding them
to `safelist`. It is the core value of the preset for consumers.

## The problem

By default UnoCSS scans only files that pass through Vite as modules. For a
provider installed as a npm package, that typically means:

- the template code lives in `node_modules/<pkg>/dist/chunks/*.js` (after
  Vite library build), *not* in the app's sources;
- UnoCSS's default `content.pipeline.include` **excludes** `node_modules`;
- `@unocss/vite` **does not merge** `content.*` returned by a preset —
  it reads `content.filesystem` / `content.pipeline.include` strictly from
  the top‑level `defineConfig({...})`.

So even though `presetGranularNode` computes the correct scan globs
internally, those globs need to be surfaced to the UnoCSS Vite plugin via
the user config. That's exactly the role of `granularContent(options)`.

## How `granularContent` works

```ts
import { presetGranularNode, granularContent } from '@feugene/unocss-preset-granular/node'

const granularOptions = { providers: [...], components: [...] }

export default defineConfig({
  presets: [presetGranularNode(granularOptions)],
  content: granularContent(granularOptions),
})
```

`granularContent(options)` returns:

```ts
{
  filesystem: string[],           // absolute POSIX globs of selected component dirs
  pipeline: { include: RegExp[] } // extended include so node_modules .js chunks are scanned
}
```

Under the hood it:

1. Resolves the same `providers` + `components` as the preset.
2. Builds the **transitive dependencies graph** (including cross‑provider
   edges). Only components that are selected OR reachable via `dependencies`
   contribute to the scan list — nothing else.
3. For each such component computes the **single** scan directory dictated
   by the strict layout contract:
   `fileURLToPath(new URL('components/<Name>/', provider.packageBaseUrl))`.
   No fallbacks, no heuristics — the provider must emit every component
   artefact (including chunks of nested SFCs) under
   `<dist>/components/<Name>/`. The `granularChunkFileNames()` helper from
   `@feugene/unocss-preset-granular/vite` does this automatically (see
   [Vite build recipe](./authoring-providers.md#vite-build-recipe--chunkfilenames)).
   If the directory is missing or has no `index.js`, the component is
   skipped with a `console.warn`. With `scan: { strict: true }` a
   `GranularProviderContractError` is thrown instead.
4. Normalises the dir to an absolute POSIX path, resolves `realpath` for
   dedup across symlinked workspaces.
5. Emits one glob per dir with the configured extensions (default:
   `js,mjs,cjs,ts,mts,cts,jsx,tsx,vue`).

## What ends up being scanned

Given:

```ts
components: [{ provider: '@feugene/extra-simple-package', names: ['XgQuick'] }]
```

and `XgQuick` having `dependencies: ['@feugene/simple-package:XTest1']`, the
generated globs look like (paths shortened):

```
node_modules/@feugene/extra-simple-package/dist/components/XgQuick/**/*.{js,mjs,...,vue}
node_modules/@feugene/simple-package/dist/components/XTest1/**/*.{js,mjs,...,vue}
```

**Other components of those providers are NOT scanned** — the app explicitly
didn't select them, so their classes don't leak into the final CSS.

## Why the Vite build of providers matters

For scan globs to hit the real template markup, the SFC chunks must live
**inside the component's directory** in `dist/`. Vite's default behaviour is
to lump all chunks into `dist/chunks/` — which is not scanned.

The fix is the `chunkFileNames` recipe in
[Authoring providers → Vite build recipe](./authoring-providers.md#vite-build-recipe--chunkfilenames).
Any provider that ships Vue SFCs and wants to be "scannable" must apply it.

## Component groups (shared SFCs across entry-components)

When several entry‑components of a provider share a common SFC (e.g.
`FtExpenseModal`, `FtIncomeModal`, `FtTransferModal` all import
`TransactionModalHeader.vue`), Rolldown/Rollup deduplicates that SFC into
a single shared chunk. By default such chunks land in flat `dist/chunks/`
and are **not** scanned (the per‑component contract `dist/components/<Name>/`
does not include them) — utility classes from those shared SFCs go
missing.

The fix is the **component group** contract:

1. In the provider source, place shared SFCs under a `shared/` subfolder of
   a group: `src/components/<group>/shared/<File>.vue`.
2. Each entry‑component of the group declares the same `group` in its
   `defineGranularComponent({ name, group })`.
3. The `granularChunkFileNames()` helper routes shared SFC chunks to
   `dist/groups/<group>/shared/[name]-[hash].js` automatically.
4. The preset additionally scans `<packageBaseUrl>/groups/<group>/shared/`
   for every selected component that has `group: '<group>'`. The directory
   is scanned **once** per group thanks to dedup, regardless of how many
   group members are selected.

Components without `group` are isolated: their selection never pulls any
group‑shared scan, so unused groups in the provider don't pollute the CSS.

If `dist/groups/<group>/shared/` is absent (the group has no shared SFCs),
the preset silently skips it — `group` is opt‑in metadata, never an error.

## `scan` option — advanced

`presetGranularNode({ scan: { ... } })`:

- `enabled: boolean` (default `true`) — set `false` to disable the built‑in
  computation entirely (useful if you build your own globs).
- `extensions: string[]` — **additional** file extensions, appended to the
  defaults `js/mjs/cjs/ts/mts/cts/jsx/tsx/vue` (e.g. `['mdx']` scans the
  defaults *plus* `.mdx`).
- `replaceExtensions: boolean` (default `false`) — treat `extensions` as the
  **complete** list instead of an addition. With `true` and no `extensions`,
  no extension globs are built at all — only `extraGlobs` remain.
- `extraGlobs: string[]` — appended as‑is to the generated globs. Useful for
  scanning non‑component files (mixins, helpers) that also contain class
  literals.
- `includeNodeModules: boolean` (default `true`) — when `false`, any scan dir
  that resolves to a path inside `node_modules` is dropped. Useful if you
  link providers as workspace symlinks and prefer to scan only the real
  source locations.
- `strict: boolean` (default `false`) — when `true`, a layout contract
  violation (no `<packageBaseUrl>/components/<Name>/` or no `index.js` inside)
  throws `GranularProviderContractError` instead of `console.warn` + skip.

## Monorepo / workspace gotchas

- Workspace‑linked providers resolve through `realpath` to their real
  source — the preset dedups so you don't end up scanning the same files
  twice.
- The layout contract is strict: the only source is
  `<packageBaseUrl>/components/<Name>/`. The answer to “where to scan” is
  unambiguous regardless of whether the package is installed under
  `node_modules` or symlinked from a workspace.

## Pitfalls (quick reference)

- Forgot `content: granularContent(options)` → classes like `p-5` don't
  appear in the output. Symptom: works with `safelist`, stops working
  without it. Fix: add the helper.
- Provider built with flat `dist/chunks/` → same symptom; fix: adopt the
  `chunkFileNames` recipe.
- `packageBaseUrl` built as `new URL('..', import.meta.url)` → becomes
  `data:` URL at build; scan dirs collapse to nothing. Fix: build the URL
  at runtime (see [Authoring providers](./authoring-providers.md)).
