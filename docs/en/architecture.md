# Architecture

> See also: [Component scanning](./component-scanning.md),
> [Themes and tokens](./themes-and-tokens.md).

This page describes how the preset is put together internally so you can
reason about its behaviour, trace issues, and extend it.

## Two entry points

| Entry                                       | When to use                                 | Side‑effects         |
|---------------------------------------------|---------------------------------------------|----------------------|
| `@feugene/unocss-preset-granular`           | Browser / runtime (no `fs`)                 | none                 |
| `@feugene/unocss-preset-granular/node`      | Build‑time (Vite, CLI, tests)               | reads files from disk|
| `@feugene/unocss-preset-granular/contract`  | Provider authors — types + `define*` helpers| none (types)         |

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

1. **Provider validation** — ensures every `id` is unique, `contractVersion`
   is supported, no duplicate component names within a provider.
2. **Expand providers** — `expandProviders(options.providers)` flattens a
   mix of objects, factory functions, and arrays into a canonical list.
3. **Build the component registry** — a map `providerId:Name → descriptor`
   across all providers. Cross‑provider `dependencies` are resolved against
   this registry.
4. **Resolve selection** — from `options.components` (which is `'all'` or a
   list of selectors) compute the set of selected components.
5. **Resolve transitive dependencies** — BFS over `descriptor.dependencies`
   with cycle detection (`CircularDependencyError` /
   `CircularProviderDependencyError`).
6. **Resolve themes** — intersect `options.themes.names` with what each
   provider declares in `theme.themes`; fall back to `defaultThemes`.
7. **Emit `safelist`** — union of `descriptor.safelist` of every resolved
   component.
8. **Emit preflights** — for the node entry: read `base.css`, `tokens.css`,
   each selected theme CSS, and each resolved component's `cssFiles` from
   disk; embed the concatenated string into a UnoCSS preflight.
9. **Emit `rules` / `variants` / custom preflights** — from
   `provider.unocss.*` of every *used* provider (unless
   `includeProviderUnocss: false`).
10. **Emit `content.filesystem`** — only the node entry; consumed via
    `granularContent(options)`.

If any step fails (unknown component, cross‑provider edge to a
non‑registered provider, missing CSS file in strict mode) a typed error is
raised — see [`src/core/errors.ts`](../../packages/unocss-preset-granular/src/core/errors.ts).

## Layers

Everything the preset emits lives under a single configurable `layer`
(default: `granular`). The layer is opaque to consumers — it just controls
ordering relative to other UnoCSS layers:

```ts
// Typical layer order in an app, from top to bottom of the output:
// preflights > granular > utilities > shortcuts
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

The **`src/` ↔ `dist/` fallback** applies to `cssFiles`: when reading a
file, if the primary path doesn't exist, the node layer probes the
sibling `src/` / `dist/` location. This lets the same provider code work
both in monorepo dev (sources available) and in a published package
(`dist/` only).

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
- `@feugene/unocss-preset-granular/node`
  - `presetGranularNode(options)` — node preset factory.
  - `granularContent(options)` — mandatory content helper.
  - `resolveGranularFilesystemGlobs(options)` — lower‑level access to the
    globs.
  - `tokenDefinitionsFromCss[Sync]`,
    `parseCssCustomPropertyBlocks[Sync]`.
- `@feugene/unocss-preset-granular/contract`
  - Type‑only re‑export surface for provider authors:
    `GranularProvider`, `GranularComponentDescriptor`, `defineGranular*`
    helpers.
