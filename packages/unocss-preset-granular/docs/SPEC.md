# Granular provider contract — specification

**Contract version:** 1 (`GRANULAR_CONTRACT_VERSION`)
**Defined by:** `@feugene/unocss-preset-granular` 0.8.x
**Status:** normative for contract version 1

This document specifies what a **granular provider** is: the shape of the
objects a component package publishes, the on-disk layout its build must
produce, the order in which the preset resolves them, and the conditions under
which resolution fails. It is written for authors of provider packages and of
alternative implementations — a package that satisfies this document works with
the preset regardless of how it was built.

It is a *specification*, not a tutorial. Task-oriented guides live in
[`docs/en`](../../../docs/en/README.md) / [`docs/ru`](../../../docs/ru/README.md);
where they disagree with this document about behaviour, this document and the
test suite win.

## 1. Conformance and terminology

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT** and **MAY**
are to be interpreted as described in RFC 2119.

- **Provider** — a package that exports a `GranularProvider` object.
- **Component** — one entry of `provider.components`, a
  `GranularComponentDescriptor`.
- **Consumer** — the application whose `uno.config.ts` lists providers.
- **Preset** — the implementation of this contract in
  `@feugene/unocss-preset-granular`.
- **Browser layer** — code reachable from the `.` and `./contract` entries.
  **Node layer** — code reachable from `./node`.

A provider is **conformant** if (a) its exported object satisfies §3–§6, (b) its
published files satisfy the layout contract in §7, and (c) `granular doctor`
(§10) exits `0` against a configuration that selects all of its components.

Sections marked *(informative)* explain rationale and bind no implementation.

## 2. Contract version

Every provider **MUST** declare `contractVersion: 1`. The preset compares it
against `GRANULAR_CONTRACT_VERSION` by strict equality and throws
`UnsupportedContractVersionError` on any mismatch — including a *newer* value.
There is no forward compatibility within a major contract version.

Adding an **optional** field to any interface in this document is a
backward-compatible change and does not bump the contract version. Removing a
field, making an optional field required, or changing the meaning of an
existing value does, and requires a support policy for version N−1.

## 3. `GranularProvider`

```ts
interface GranularProvider {
  id: string
  contractVersion: 1
  packageBaseUrl: string
  components: readonly GranularComponentDescriptor[]
  theme?: GranularThemeContribution
  unocss?: GranularUnocssContribution
  dependencies?: readonly (GranularProvider | string)[]
}
```

| Field | Requirement |
|---|---|
| `id` | **MUST** be a non-empty, non-whitespace string, unique across the consumer's resolved graph. It is the prefix of every component key `providerId:Name`. It **MAY** contain `:` (see §5.1). Convention: the npm package name. |
| `contractVersion` | **MUST** be `1`. |
| `packageBaseUrl` | **MUST** be an absolute URL **ending in `/`**, denoting the **directory** that is the root of the published layout (§7) — not a module. |
| `components` | **MUST** be an array. Names within one provider **MUST** be unique. |
| `theme` | See §6. |
| `unocss` | `rules`, `variants` and FS-free inline `preflights`, merged into the consumer's UnoCSS config. |
| `dependencies` | Package-level composition; see §3.2. |

Violations of the `id`, `packageBaseUrl`, `components` and
`cssFiles`/`cssFileAssetNames` rules are detected at **registration time** and
raise `InvalidProviderError` with a machine-readable `reason`.

### 3.1 `packageBaseUrl` *(partly informative)*

The trailing `/` is normative because every derived path is computed with
`new URL(relative, packageBaseUrl)`. Without it the last segment is discarded
and the whole layout resolves one directory too high — silently, producing an
empty scan rather than an error. The preset therefore rejects it up front
(`reason: 'package-base-url-not-a-directory'`).

Providers **SHOULD** compute the value with
`resolvePackageBaseUrl(import.meta.url, levelsUp?)` from `./contract`.

Providers **MUST NOT** write `new URL('..', import.meta.url)` in their own
source. Vite and rolldown recognise that exact literal and replace it with a
`data:` URL at build time; the resolved base then points nowhere and every scan
directory silently disappears. `resolvePackageBaseUrl` takes the base as an
argument, leaving the bundler nothing to substitute.

The value depends on where the **bundler places the emitting module**, not on
the source tree. It **SHOULD** be verified against the built package (§10), not
reasoned about.

### 3.2 Provider dependencies

`dependencies` accepts two forms with different semantics:

- **Instance** (`GranularProvider`) — pulls the donor into the graph. A
  composite provider **SHOULD** use this form so that consumers need only list
  the composite.
- **String** (`id`) — a *soft* requirement. It does not pull anything in; it
  asserts that a provider with that `id` is present in the expanded registry by
  the end of resolution. If it is not, resolution fails with
  `UnresolvedProviderDependencyError`.

Declaring a provider dependency **does not** select any of the donor's
components. Component selection remains the consumer's (§5).

A provider that references another provider's components in
`component.dependencies` **MUST** declare that donor in its own
`peerDependencies`.

## 4. `GranularComponentDescriptor`

```ts
interface GranularComponentDescriptor {
  name: string
  dependencies?: readonly GranularComponentDependency[]
  safelist?: readonly string[]
  cssFiles?: readonly string[]
  cssFileAssetNames?: readonly string[]
  styleAssetFileName?: string | null
  tokenDefinitions?: Readonly<Record<string, GranularThemeTokenSet>>
  tokenDefinitionsRef?: Readonly<Record<string, GranularThemeTokenRef | string>>
  group?: string
}
```

| Field | Requirement |
|---|---|
| `name` | **MUST** be unique within the provider. It is also the directory name in the layout contract (§7), so it **MUST** be a valid path segment. Duplicates raise `DuplicateComponentNameError`. |
| `dependencies` | Other components required by this one; see §4.1. A component whose emitted code imports another component's directory (§7) **MUST** declare that component here. |
| `safelist` | **MUST** contain only this component's **own** classes, and only those that static extraction cannot see (classes built at runtime). Classes written literally in the template **MUST NOT** be listed — scanning (§7) covers them. |
| `cssFiles` | Absolute URL strings, normally produced by `defineGranularComponent`. Loaded as UnoCSS preflights. |
| `cssFileAssetNames` | Positional fallback for `cssFiles`; see §4.2. |
| `styleAssetFileName` | Consumed by `granularAssetFileNames()` from `./vite`, **not** by the preset. It **MUST** agree with `cssFileAssetNames` about the layout. Deprecated — a candidate for removal in contract version 2. |
| `tokenDefinitions` / `tokenDefinitionsRef` | Component-scoped theme tokens; see §6. |
| `group` | Opt-in to scanning shared chunks; see §7.2. |

Descriptors **SHOULD** be produced by `defineGranularComponent(import.meta.url, …)`,
which resolves `cssFiles` to absolute URLs, derives `cssFileAssetNames` and
`styleAssetFileName`, and normalises `tokenDefinitionsRef`. Hand-written
descriptors **MUST** reproduce those invariants themselves.

### 4.1 Dependency forms

A `GranularComponentDependency` is one of:

1. `'Name'` — a component of the **same** provider.
2. `'providerId:Name'` — a qualified reference to any registered provider.
3. `{ provider, components: [...] }` — several components of one provider.

Form 1 is available **only** in `component.dependencies`. It is **not** valid
in the consumer's `options.components`, which requires a qualified key or the
object form.

The declared graph **MUST** cover what the provider actually ships: if a
component's emitted code imports a file under another component's directory
(§7), directly or through a shared chunk, that component **MUST** be reachable
from its `dependencies`. Nothing in a provider's build enforces this —
bundlers do not read `dependencies` — and the consequence of a missing edge is
silent: an application selecting only the outer component never scans the inner
one's directory and never merges its `safelist` (§7.1). `granular doctor`
reports the divergence as `undeclared-dependency` (§10).

The converse is **not** required: importing a constant, a type or a helper from
another component's directory is not a dependency in this sense. Declaring it
pulls the donor's whole `safelist` and CSS into every consumer.

### 4.2 CSS file fallback

`cssFiles[i]` and `cssFileAssetNames[i]` are matched **by position**. If
`cssFiles[i]` does not exist on disk, the node layer reads
`new URL(cssFileAssetNames[i], packageBaseUrl)` instead.

If both arrays are non-empty their lengths **MUST** be equal; a mismatch raises
`InvalidProviderError` (`reason: 'css-files-length-mismatch'`) rather than
silently disabling the fallback for the surplus entries.

There is no probing of a sibling `src/` or `dist/` directory. The fallback is
exactly the asset name resolved against `packageBaseUrl`, and nothing else.

If neither path exists, the read fails with `GranularCssReadError` carrying the
provider, section and subject, with the underlying `ENOENT` as `cause`. This is
a hard failure: there is no lenient mode for missing CSS.

## 5. Selection

The consumer selects components via `options.components`:

```ts
type ComponentSelection = 'all' | readonly ComponentSelectionItem[]
type ComponentSelectionItem = string | { provider: string, names: 'all' | readonly string[] }
```

`'all'`, and an omitted `components`, both select every component of every
registered provider.

### 5.1 Qualified key parsing

In a string selection item the separator is the **last** colon. Both sides
**MUST** be non-empty. Therefore `'a:b:C'` denotes component `C` of provider
`a:b` — provider ids containing colons are supported and are not ambiguous.
A string that does not parse raises `InvalidComponentKeyError`.

### 5.2 Transitive closure

The preset walks `component.dependencies` recursively from the initial
selection. The resulting order is **post-order DFS: dependencies precede
dependents**. This order is normative — token merge precedence (§6.3) and CSS
emission order (§8) depend on it.

An unknown provider raises `ProviderNotRegisteredError`; an unknown component
raises `ComponentNotFoundError` (listing the names the provider does have); a
cycle raises `CircularDependencyError` with the full chain.

## 6. Themes and tokens

```ts
interface GranularThemeContribution {
  baseCssUrl?: string
  tokensCssUrl?: string
  themes?: Readonly<Record<string, string>>
  tokenDefinitions?: Readonly<Record<string, GranularThemeTokenSet>>
  tokenDefinitionsRef?: Readonly<Record<string, GranularThemeTokenRef | string>>
  defaultThemes?: readonly string[]
}

interface GranularThemeTokenSet {
  selector?: string
  tokens: Readonly<Record<string, string>>
}
```

### 6.1 Token naming

Token keys in `tokens` **MUST NOT** include the `--` prefix. The generator adds
it. `{ '--brand': '#fff' }` emits `----brand`, which is a valid CSS custom
property and therefore fails silently rather than erroring.

### 6.2 Active theme set

The set of themes emitted into CSS is determined in this order:

1. `options.themes.names`, if present — including `[]`, which means *no
   themes* and stops here.
2. Otherwise, the keys of `options.themes.define`, if present.
3. Otherwise, the union of `defaultThemes` of **all** providers in the resolved
   graph (transitive donors included), in provider order, deduplicated.
4. Otherwise, the fallback `['light']`.

`doctor` reports which of the four applied (`namesSource`).

A provider **SHOULD** list a theme in `defaultThemes` only if it actually
supplies it (`themes[name]` or `tokenDefinitions[name]`). A theme activates for
the whole build, so an empty declaration leaves *other* providers' components
without tokens for it. This is reported as a warning, not an error.

Only the intersection of a provider's `themes` map with the active set is
loaded.

### 6.3 Token precedence

For a given theme and selector, values are applied in this order, each layer
overriding the previous:

1. provider `theme.tokenDefinitions`;
2. component `tokenDefinitions`, in selection order (§5.2);
3. app themes declared via `themes.define`;
4. app `themes.tokenOverrides`.

Where a provider supplies both `themes[X]` (a CSS file) and
`tokenDefinitions[X]` for the same theme, the structural definition wins and
the file is not loaded — structural tokens are what makes targeted overrides
possible.

A token written by more than one layer is a *conflict*: legal, frequently
intentional, and reported by `doctor` with its full source chain.

If `GranularThemeTokenSet.selector` is omitted, the selector of the first
provider block for that theme is used.

### 6.4 `tokenDefinitionsRef`

A reference declares *where* tokens live instead of enumerating them; the node
layer reads the file while loading the consumer's config.

```ts
interface GranularThemeTokenRef {
  url: string
  selector?: string   // which selector to extract; default ':root'
  as?: string         // which selector to emit under; default: the extracted one
  strict?: boolean    // default true
  assetName?: string  // published-package fallback, like cssFileAssetNames
}
```

A bare string is shorthand for `{ url }`. Relative URLs are resolved against
the calling module's `import.meta.url` by the `define*` helpers, which also fill
in `assetName`.

Only references for themes that can become active in the build — the active
set (§6.2) plus transitive `extends` bases — are read. A reference belonging
to any other theme is ignored: its file is never touched, and a broken URL
there does not fail the build.

`strict` defaults to **`true`**: a missing selector or unsupported nesting is an
error, not a quietly empty theme.

Literal `tokenDefinitions` for a theme take precedence over a reference for the
same theme.

This is the mechanism that lets a browser-safe `config.ts` publish
CSS-sourced tokens. A component **MUST NOT** import `./node` to read them (§9).

## 7. Package layout contract

Component scanning is what removes the need for a hand-maintained `safelist`,
and it is the part of the contract expressed in **files** rather than objects.

### 7.1 Per-component directories

For every component, the provider's published output **MUST** contain

```
<packageBaseUrl>/components/<Name>/index.js
```

and the real component source (SFC bodies and their chunks) **MUST** live under
that directory. The preset hands
`<packageBaseUrl>/components/<Name>/**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx,vue}`
to UnoCSS `content.filesystem`.

The default extension list is *additive*: `scan.extensions` adds to it, and
replaces it only together with `scan.replaceExtensions: true`.

If the directory or its `index.js` is missing, or `packageBaseUrl` does not
resolve, the component is **skipped**: a `console.warn` is emitted and its
classes never reach the CSS while the build stays green. With
`scan: { strict: true }` the same condition throws
`GranularProviderContractError` instead. `doctor` reports it either way and
exits `1`.

*(Informative)* A flat `dist/chunks/` — the default of most bundler configs —
violates this contract. `granularChunkFileNames()` from `./vite` produces a
conforming `output.chunkFileNames`.

### 7.2 Group-shared chunks

When a descriptor declares `group: '<g>'`, the preset additionally scans

```
<packageBaseUrl>/groups/<g>/shared/
```

This is where a build places SFC chunks imported by several entry components of
the same group. Without `group` the directory is not scanned and the component
is treated as isolated.

## 8. CSS emission order

The node layer emits one FS-backed preflight whose sections appear in this
order, which is normative:

1. `tokensCssUrl` (theme-independent tokens), then `baseCssUrl` — each once
   globally, subject to app overrides;
2. structural theme token blocks (`tokenDefinitions` + `tokenOverrides`);
3. theme CSS files, for themes with no structural definition, deduplicated by
   final URL;
4. component `cssFiles`, in selection order (§5.2).

Everything the preset emits goes into the layer named by `options.layer`,
default `'granular'`, and the preset declares that layer's order as **−50** —
after `preflights` (−100), before `shortcuts` (−10) and utilities (0), so a
utility class beats a component's base style. `layer: null` disables the layer.

An implementation that emits a layer **MUST** also declare its order: UnoCSS
assigns an unknown layer order `0`, tying with `default` and breaking the tie
alphabetically, which moves component CSS *after* utilities.

`cssFiles` are loaded as preflights, which bypass
`transformer-directives`. `@apply` inside them is expanded only when the
consumer sets `expandDirectives: true`.

## 9. The browser/node boundary

| Entry | May use `node:` builtins | Contents |
|---|---|---|
| `.` | No | preset (browser), contract re-exports |
| `./contract` | No | types and `define*` helpers |
| `./vite` | Yes (build stage) | provider build helpers: pure naming callbacks (`granularChunkFileNames`, `granularAssetFileNames`) and `granularCssAssetsPlugin`, which reads and writes the filesystem |
| `./runtime` | No | `createThemeController` |
| `./node` | Yes | node preset, `granularContent`, doctor, CSS reading |
| `./codegen` | Yes | `runRegistryCodegen` and its targets: a provider's own tooling, reads `src/components/` and rewrites the package's registries |

A provider's browser entry — and therefore any component `config.ts` reachable
from it — **MUST NOT** import `./node`, `./vite` or `./codegen`, nor a donor's
`/node` entry. `./codegen` is a provider's own tooling: it belongs in scripts
and tests, never in shipped code.
`./vite` is build-configuration code (`vite.config.ts` runs in Node),
and its entry carries static `node:` imports even though the naming callbacks
themselves are pure. Importing either entry pulls `node:fs` into the client
bundle. **The build does not fail**; only the consumer's runtime does.

Conformance **SHOULD** be checked against build output, not sources:

```bash
grep -rn "unocss-preset-granular/\(node\|vite\|codegen\)" dist/granular-provider.js dist/chunks/*.js
# must print nothing
```

## 10. Verification

`granular doctor <options-file>` resolves a configuration through the same
pipeline the build uses and exits `1` on any layout-contract violation. It is
the normative conformance check for §7 and **SHOULD** run in a provider's CI.
See [The `granular` CLI](../../../docs/en/cli.md).

It also compares the declared dependency graph (§4.1) against the imports
present in the emitted code of the selected components and reports every edge
not covered by the graph as `undeclared-dependency`. That check is heuristic —
it reads the text of the bundle, not an AST — so its level is `warn`: it moves
`clean`, not `ok`, and fails the command only under `--strict`. A provider's CI
**SHOULD** run it with every component selected, since only selected components
serve as sources. Its limits are listed in
[The `granular` CLI](../../../docs/en/cli.md).

`doctor` does **not** verify that declared CSS files exist (§4.2), that the
browser/node boundary is intact (§9), or that `safelist` is minimal. Those
require the checks described in their own sections.

## 11. Error conditions

Every rejection is a typed error class from `core/errors.ts` (or
`fs/*`), carrying structured fields — not just a message.

| Condition | Error | Thrown at |
|---|---|---|
| `contractVersion !== 1` | `UnsupportedContractVersionError` | registration |
| Empty / non-string `id` | `InvalidProviderError` (`invalid-id`) | registration |
| `packageBaseUrl` not an absolute URL | `InvalidProviderError` (`invalid-package-base-url`) | registration |
| `packageBaseUrl` without trailing `/` | `InvalidProviderError` (`package-base-url-not-a-directory`) | registration |
| `components` not an array | `InvalidProviderError` (`invalid-components`) | registration |
| `cssFiles` / `cssFileAssetNames` length mismatch | `InvalidProviderError` (`css-files-length-mismatch`) | registration |
| Two different instances with one `id` | `DuplicateProviderIdError` | registration |
| Two components with one name in a provider | `DuplicateComponentNameError` | registration |
| Cycle in `provider.dependencies` | `CircularProviderDependencyError` | registration |
| String dependency never satisfied | `UnresolvedProviderDependencyError` | registration |
| Selection key not of the form `providerId:Name` | `InvalidComponentKeyError` | selection |
| Selection references an unregistered provider | `ProviderNotRegisteredError` | selection |
| Selection references an unknown component | `ComponentNotFoundError` | selection |
| Cycle in `component.dependencies` | `CircularDependencyError` | selection |
| Missing component directory, `scan.strict` | `GranularProviderContractError` | scan |
| Missing component directory, default | `console.warn`, component skipped | scan |
| CSS file missing on both path and fallback | `GranularCssReadError` | CSS read |
| CSS source is a non-`file:` URL or a malformed `data:` URL | `GranularCssSourceError` | CSS read |
| Strict token-ref parse failure (unsupported blocks, no tokens, selector not found) | `GranularTokenParseError`, wrapped in `GranularTokenRefError` | ref materialization |
| A component's config export is named other than the registry expects | `GranularCodegenError` (`config-export-name-mismatch`) | registry codegen |
| A generated block has no opening / closing marker | `GranularCodegenError` (`missing-open-marker` / `missing-close-marker`) | registry codegen |
| `package.json` has no `exports` | `GranularCodegenError` (`missing-package-exports`) | registry codegen |
| No component subpath in `exports` to anchor the run to, **and** components exist | `GranularCodegenError` (`no-component-exports`) | registry codegen |
| Neither an anchor nor any component (a freshly scaffolded package) | no-op, `exports` left as-is | registry codegen |
| The components directory does not exist | `GranularCodegenError` (`missing-components-dir`) | registry codegen |
| The components directory exists but is empty | zero components; every generated run is emptied | registry codegen |

*(Informative)* Registration-time failures are deliberate: each of them used to
surface much later as an empty scan, a bare `ERR_INVALID_URL_SCHEME`, or CSS
that was simply absent.

## 12. Conformance checklist

- [ ] `contractVersion: 1`; `id` unique and non-empty.
- [ ] `packageBaseUrl` from `resolvePackageBaseUrl(import.meta.url)`, ends with
      `/`, and contains no `data:` URL in the built output.
- [ ] `dist/components/<Name>/index.js` exists for every component, with the
      real SFC code beneath it.
- [ ] `package.json.exports` publishes every one of those subpaths.
- [ ] `safelist` holds only own, non-statically-extractable classes.
- [ ] Token keys carry no `--` prefix.
- [ ] Browser entry free of `./node` and `./vite` imports, verified on the bundle.
- [ ] Cross-provider donors listed in `peerDependencies`.
- [ ] `granular doctor --strict` exits `0` with all components selected — in
      particular, no `undeclared-dependency`.
- [ ] Smoke test: install into a fresh app, select one component, build, and
      confirm its classes appear in the CSS with no `safelist`.

## 13. Reference implementation *(informative)*

The preset's test suite (`src/__tests__`) is the executable form of this
document; where prose here is ambiguous, the tests define the behaviour.
`packages/simple-package` and `packages/extra-simple-package` in this
repository are conformant reference providers — the latter exercises
cross-provider dependencies — and `apps/app-1`…`app-6` exercise the contract
end to end.
