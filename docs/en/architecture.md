# Architecture

> See also: [Component scanning](./component-scanning.md),
> [Themes and tokens](./themes-and-tokens.md).

This page describes how the preset is put together internally so you can
reason about its behaviour, trace issues, and extend it.

## Four entry points

| Entry                                       | When to use                                 | Side‑effects         |
|---------------------------------------------|---------------------------------------------|----------------------|
| `@feugene/unocss-preset-granular`           | Browser / runtime (no `fs`)                 | none                 |
| `@feugene/unocss-preset-granular/node`      | Build‑time (Vite, CLI, tests)               | reads files from disk|
| `@feugene/unocss-preset-granular/contract`  | Provider authors — types + `define*` helpers| none (types)         |
| `@feugene/unocss-preset-granular/vite`      | A **provider's** Vite build — `granularChunkFileNames`, `granularAssetFileNames` | none (pure functions) |

The `/vite` entry is part of the scanning contract, not an optional extra:
without `granularChunkFileNames` in the provider's `build.rollupOptions`, SFC
chunks land outside the component directory and are never scanned — see
[Component scanning](./component-scanning.md).

The browser entry (`presetGranular`) produces a pure‑JS preset:
`rules` / `variants` / `safelist` / `preflights` (inline only). The node
entry (`presetGranularNode`) composes on top and adds:

1. **CSS preflights from disk** — base / tokens / themes / component `cssFiles`
   are read at config time and embedded as preflights (one per layer).
2. **`content.filesystem` computation** — transitive component graph is
   resolved and turned into scan globs (surfaced to the app through the
   `granularContent(options)` helper).
3. **`tokenDefinitionsFromCss*` helpers** — used by a provider's node entry
   when it wants to expose structural tokens (see
   [Themes and tokens](./themes-and-tokens.md)).

## Resolution pipeline

For a given `presetGranular*(options)` call the core does, in order:

1. **Expand providers** — `expandProviders(options.providers)` walks
   `provider.dependencies` and flattens the graph into a deduplicated,
   topologically ordered list of `GranularProvider` objects. Duplicate `id`s
   backed by two different instances raise `DuplicateProviderIdError`;
   provider dependency cycles raise `CircularProviderDependencyError`; a
   `contractVersion` other than the supported one (`GRANULAR_CONTRACT_VERSION`)
   raises `UnsupportedContractVersionError`.
2. **Build the component registry** — a map `providerId:Name → descriptor`
   across all providers. Cross‑provider `dependencies` are resolved against
   this registry. Two components sharing a name **inside one provider** raise
   `DuplicateComponentNameError` (fail‑fast — a publishing bug).
3. **Resolve selection** — from `options.components` (which is `'all'` or a
   list of selectors) compute the set of selected components.
4. **Resolve transitive dependencies** — DFS (post‑order) over
   `descriptor.dependencies` with cycle detection (`CircularDependencyError` /
   `CircularProviderDependencyError`); dependencies are emitted before the
   components that depend on them.
5. **Resolve themes** — take the theme names from `options.themes.names`, or,
   when it is omitted, from the union of every provider's
   `theme.defaultThemes` (fallback: `['light']`), then intersect them with
   what each provider declares in `theme.themes`/`tokenDefinitions`. Token
   sets are grouped **per selector** into `tokenRegistry[theme].blocks`, so
   different sources can contribute distinct selector blocks to one theme.
6. **Emit `safelist`** — union of `descriptor.safelist` of every resolved
   component.
7. **Emit preflights** — for the node entry: read `base.css`, `tokens.css`,
   each selected theme CSS, and each resolved component's `cssFiles` from
   disk; embed the concatenated string into a UnoCSS preflight.
8. **Emit `rules` / `variants` / custom preflights** — from
   `provider.unocss.*` of **every provider in the expanded graph** —
   `options.providers` plus their transitive `dependencies`, whether or not
   any of their components ended up selected (unless
   `includeProviderUnocss: false`). This matches the base/tokens/themes
   sections, which are inlined from the same full list.
9. **Emit `content.filesystem`** — only the node entry; consumed via
   `granularContent(options)`.

The whole resolution above (`resolvePresetGranular`) is **memoized by the
identity of the `options` object**, so calling `presetGranularNode(options)`
and `granularContent(options)` with the same object computes the graph once.

If a resolution step fails (unknown component, cross‑provider edge to a
non‑registered provider, duplicate id, dependency cycle, unsupported
`contractVersion`, malformed provider) a typed error is raised — see
[`src/core/errors.ts`](../../packages/unocss-preset-granular/src/core/errors.ts).

Provider shape is validated **at registration** (`expandProviders`), not when
the file system first trips over it: an empty `id`, a `packageBaseUrl` that is
not an absolute URL or does not end with `/`, and a length mismatch between
`cssFiles` and `cssFileAssetNames` all raise `InvalidProviderError`.

Reading CSS raises `GranularCssReadError`, which names the provider, the
section (base/tokens, theme, component) and the theme/component involved, and
keeps the original `ENOENT` in `cause`. There is no strict mode for CSS
reading — `scan.strict` only governs the directory layout contract (see
below).

## Layers

Everything the preset emits lives under a single `layer`, named **`granular`
by default**. It covers the FS and inline preflights and — because UnoCSS
stamps a preset's layer onto its rules — the providers' `unocss.rules` too.

The preset also **declares that layer's order** (`-50`), which places it
between UnoCSS's own `preflights` (`-100`) and `shortcuts` (`-10`) / `default`
(`0`):

```
imports (-200) → preflights (-100) → granular (-50) → shortcuts (-10) → utilities (0)
```

That ordering is the point: a utility (`p-5`) must win over a component's base
style, not the other way round. Declaring the order is **required** for that —
an unknown layer name falls back to order `0`, i.e. the same bucket as
`default`, where the tie is broken alphabetically and `granular` would end up
*after* the utilities, silently overriding them.

Two escape hatches:

- `layer: 'my-name'` — same behaviour under a different name (the order is
  declared for whatever name you pass);
- `layer: null` — no layer at all: preflights fall back to UnoCSS's
  `preflights` layer, provider rules to `default`.

The app always has the last word — `layers` in its own `defineConfig` is
merged after presets:

```ts
defineConfig({
  presets: [presetGranularNode(opts)],
  layers: { granular: 50 }, // push granular after the utilities instead
})
```

Per‑component / per‑theme preflights are tagged with the same layer (unless
a provider explicitly overrides it) so they're ordered consistently.

## File system conventions

The node entry assumes each provider follows this layout relative to
`packageBaseUrl`:

```
<packageBaseUrl>/
├─ components/<Name>/...        ← scan dir + optional styles.css
├─ styles/base.css               ← optional baseCssUrl
├─ styles/tokens.css             ← optional tokensCssUrl
└─ styles/themes/<name>.css      ← optional themes[<name>]
```

but **none of these paths is hard‑coded**: they are just convenient defaults.
Every path is explicit in the provider's `defineGranularProvider(...)` call
and can point anywhere inside the package.

The **`cssFiles` fallback** works like this (`src/fs/readCss.ts`,
`resolveComponentCssFile`): the node layer first tries the URL from
`descriptor.cssFiles[i]`. If that file does not exist, it takes the matching
`descriptor.cssFileAssetNames[i]` and resolves it **relative to the provider's
`packageBaseUrl`** — i.e. `<packageBaseUrl>/<assetName>`. For components built
with `defineGranularComponent` that asset name is generated as
`components/<Name>/<file>`. Neither `src/` nor
`dist/` appears anywhere in that logic; the mechanism works across the two
only because a provider points `packageBaseUrl` at its own package root, which
differs between a source checkout and a published build.

Two consequences worth knowing:

- the two arrays are matched **by position**, so a length mismatch silently
  disables the fallback for the trailing entries;
- if the fallback path is missing too, the read fails with
  `GranularCssReadError` naming the provider and component (the raw `ENOENT`
  stays in `cause`).

## Why `content` lives on the user config, not on the preset

Technically a UnoCSS preset *can* return `content.filesystem`, but
`@unocss/vite` only consumes `content.*` from the top‑level user config —
preset‑level `content` is ignored by the Vite plugin's file watcher and
scanner. This is a property of UnoCSS's architecture, not a bug in the
preset. To bridge the gap, we expose a pure helper `granularContent(options)`
that the app calls once in its `uno.config.ts`. Inputs are the same as for
`presetGranular*`, so the two stay in sync.

## Public exports (quick map)

- `@feugene/unocss-preset-granular`
  - `presetGranular(options)` — browser preset factory.
  - `defineGranularComponent`, `defineGranularProvider`, types from
    `./contract`.
  - `expandProviders`, `ComponentSelection`, `ResolvedThemeItem`,
    `CircularDependencyError`, etc.
- `@feugene/unocss-preset-granular/node` — a **superset** of the root entry
  (it re‑exports everything from `.` plus the node‑only helpers below), so an
  app config only needs this one import.
  - `defineGranular(options)` — recommended single builder; returns
    `{ preset(), content(), resolution(), nodeCss() }` backed by one memoized
    resolution (keeps `preset()` and `content()` in sync automatically).
  - `presetGranularNode(options)` — node preset factory.
  - `granularContent(options)` — mandatory content helper (when not using
    `defineGranular`).
  - `resolveGranularFilesystemGlobs(options)` — lower‑level access to the
    globs.
  - `getGranularThemeCss` / `getGranularComponentCss` — theme‑only and
    component‑only CSS slices (their concatenation equals `getGranularNodeCss`).
  - `granularDoctor(options)` / `formatDoctorReport(report)` — diagnostics
    (also exposed as the `granular doctor` CLI).
  - `tokenDefinitionsFromCss[Sync]`,
    `parseCssCustomPropertyBlocks[Sync]`.
  - `clearCssCache()` / `getCssCacheSize()` — the CSS read cache is
    invalidated per file by `(mtime, size)` and bounded by
    `CSS_CACHE_MAX_ENTRIES` (LRU), so a long‑running dev server cannot grow it
    without limit; the explicit reset is there for tooling.
  - `inspectGranularScanDirs(options)` — what actually goes into the scan
    (`dirs`) and what was skipped by the layout contract (`skipped`); the
    single, memoized FS walk shared with `granularContent` and the doctor.
- `@feugene/unocss-preset-granular/contract`
  - Surface for provider authors: `GranularProvider`,
    `GranularComponentDescriptor`, `defineGranular*` helpers and
    `resolvePackageBaseUrl(importMetaUrl, levelsUp?)`.
- `@feugene/unocss-preset-granular/vite`
  - `granularChunkFileNames(options?)` — routes SFC chunks into
    `components/<Name>/chunks/`.
  - `granularAssetFileNames(options?)` — routes component CSS into
    `components/<Name>/styles.css`.
