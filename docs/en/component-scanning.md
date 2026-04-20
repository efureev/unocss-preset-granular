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
3. For each such component picks a scan directory using the following
   priority chain:
   1. `sourceDirAssetName` (if the component declares `sourceDir` and the
      provider was built with an `assetName`‑mapped layout).
   2. `sourceDirUrl` (from `defineGranularComponent({ sourceDir })` — resolves
      against the component's `import.meta.url`).
   3. `dirname(cssFiles[0])` — the directory of the component's first
      declared CSS file.
   4. `packageBaseUrl + 'components/<Name>/'` — convention fallback.
4. Normalises each dir to an absolute POSIX path, resolves `realpath` for
   dedup across `src/` ↔ `dist/` ↔ symlinked workspaces.
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

## `scan` option — advanced

`presetGranularNode({ scan: { ... } })`:

- `enabled: boolean` (default `true`) — set `false` to disable the built‑in
  computation entirely (useful if you build your own globs).
- `extensions: string[]` — add custom file extensions (e.g. `mdx`).
- `extraGlobs: string[]` — appended as‑is to the generated globs. Useful for
  scanning non‑component files (mixins, helpers) that also contain class
  literals.
- `includeNodeModules: boolean` (default `true`) — when `false`, any scan dir
  that resolves to a path inside `node_modules` is dropped. Useful if you
  link providers as workspace symlinks and prefer to scan only the real
  source locations.

## Monorepo / workspace gotchas

- Workspace‑linked providers resolve through `realpath` to their real
  source — the preset dedups so you don't end up scanning the same files
  twice.
- If both `src/` and `dist/` exist and are reachable, the chain above picks
  the one that `cssFiles[0]` / `sourceDirUrl` actually points to. This is
  stable across `yarn install` and `vite build`.

## Pitfalls (quick reference)

- Forgot `content: granularContent(options)` → classes like `p-5` don't
  appear in the output. Symptom: works with `safelist`, stops working
  without it. Fix: add the helper.
- Provider built with flat `dist/chunks/` → same symptom; fix: adopt the
  `chunkFileNames` recipe.
- `packageBaseUrl` built as `new URL('..', import.meta.url)` → becomes
  `data:` URL at build; scan dirs collapse to nothing. Fix: build the URL
  at runtime (see [Authoring providers](./authoring-providers.md)).
