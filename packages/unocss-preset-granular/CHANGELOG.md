# Changelog

All notable changes to `@feugene/unocss-preset-granular`.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions are `0.x`, so **a minor bump may carry breaking changes** — each one
below says so explicitly.

What "breaking" means here, in decreasing order of blast radius:

1. **The provider contract** (`GranularProvider`, `GranularComponentDescriptor`)
   — breaks other people's packages. Guarded by `GRANULAR_CONTRACT_VERSION`,
   still `1` since the beginning.
2. **The preset options** (`PresetGranularOptions`) — breaks applications.
3. **The CLI report types** (`DoctorReport`, `ExplainReport`, `WhyCssReport`)
   — breaks tooling that reads them. These grow in minor versions by design;
   see [Report stability](https://github.com/efureev/unocss-preset-granular/blob/main/docs/en/cli.md).

Entries before `0.7.0` were reconstructed from git history and release tags —
they summarise what shipped, not what was written down at the time.

## [Unreleased]

### Added

- **`sr-only` / `not-sr-only` are now part of the `includeExtraRules` set**
  (`accessibilityRules` in `@feugene/unocss-mini-extra-rules`). Like the
  `text-transform` family, the pair lives in `presetWind*` and is absent from
  `presetMini`, so a component writing `sr-only` kept the class in the markup
  with no CSS behind it — the "visually hidden" label was simply visible, and
  nothing in the build said so.

  Declarations mirror `presetWind*` one for one: with both loaded, UnoCSS
  resolves to the last matching rule, so a divergence here would make the
  emitted CSS depend on preset order.

- **The `font-variant-numeric` family is now part of the `includeExtraRules`
  set** (`numericRules` + `numericPreflights` in
  `@feugene/unocss-mini-extra-rules`). `tabular-nums`, `ordinal`,
  `slashed-zero`, the fraction and figure-style utilities and the `normal-nums`
  reset all live in `presetWind*` only, so a component writing `tabular-nums`
  kept the class in the markup with no CSS behind it — a column of numbers
  reflowed on every change of value. The preset registers the preflight
  alongside the rules; without it the property would be assembled from
  undefined variables.

- The dependency floor moved to `@feugene/unocss-mini-extra-rules` 0.8.1: 0.8.0
  registers `@property` under a stale variable prefix after `uno.setConfig()`
  (a `uno.config.ts` edit with the dev server running), and its numeric rules
  shadow `presetWind3`'s without carrying its `preflightKeys`.

- **`object-fit` / `object-position` are part of the `includeExtraRules` set**
  (`objectRules`, shipped in `@feugene/unocss-mini-extra-rules` 0.7.0). Same
  silent failure: `object-cover` stayed in the markup while the image was
  stretched instead of cropped.

- **`granular doctor` now reports token keys declared with the `--` prefix**
  (`token-prefix`, level `warn`). The generator adds the prefix itself, so
  `'--brand'` emits a valid but useless `----brand` custom property and the
  theme silently loses the value — the single most documented trap of the
  contract (SPEC §6.1) used to pass `doctor` with `clean: true`.

- **Typed error classes for every remaining bare `Error`**: a malformed
  selection key now raises `InvalidComponentKeyError` (exported from `.`);
  a non-`file:` CSS URL or a malformed `data:` URL raises
  `GranularCssSourceError`; strict token-parse failures raise
  `GranularTokenParseError` with a machine-readable `reason` (both exported
  from `./node`); a CLI options file without the expected export raises
  `GranularOptionsLoadError`. Messages are unchanged — only the classes are
  new. SPEC §11 lists the new rows.

- **`InvalidProviderError` and `InvalidProviderReason` are now exported from
  the root entry.** The class was thrown since 0.6 but never re-exported, so
  consumers could not `instanceof` it.

### Changed

- **Breaking (report types):** `DoctorDiagnosticCode` gained `'token-prefix'`.
  Treat the union as open — same policy as in 0.7.0.
- **`tokenDefinitionsRef` are now materialized only for themes that can become
  active** (the active set of §6.2 plus transitive `extends` bases). A broken
  reference belonging to a theme the build never requested no longer fails
  config loading — and its file is no longer read at all. References of
  active themes still fail loudly with `GranularTokenRefError` (SPEC §6.4).
- **SPEC §9 corrected to match the shipped code:** the `./vite` entry is
  build-stage code and carries static `node:` imports
  (`granularCssAssetsPlugin` reads and writes the filesystem); the naming
  callbacks remain pure. Importing `./vite` from browser-reachable code is
  now explicitly forbidden, same as `./node`, and the conformance grep in
  §9/§12 covers both entries.

- **The entire user-facing surface now speaks English**: the text reports of
  `doctor` / `explain` / `why-css`, `diagnostics[].message`, the CLI usage and
  its errors, the runtime-controller errors and every `console.warn`. The
  structured (`--json`) report shapes are unchanged. Anything that matched the
  Russian text of the reports must update — the text format was never a stable
  API; parse `--json` instead.

### Fixed

- **A raw NUL byte in `src/vite-utils/cssAssets.ts`** (the dedupe key inside
  `planGranularCssAssets`) made git, `grep` and `file` treat both the source
  file and the built `dist/vite.js` as binary: diffs showed "Binary files
  differ", and the grep-based boundary checks from SPEC §9 silently matched
  nothing on those files. The byte is now written as the `\0` escape; runtime
  behaviour is unchanged.

- **`getGranularComponentCss` now wraps read failures in
  `GranularCssReadError`** naming the provider and the component, like every
  other CSS-reading path. It was the last place where a missing file produced
  a bare `ENOENT` with an absolute path and no culprit.

- **`sideEffects` corrected to `false`.** The old `["**/*.css"]` matched
  nothing — the package publishes no CSS files — and misleadingly declared
  assets that do not exist. Tree-shaking behaviour is identical.

- **`lib: ["DOM"]` removed from `tsconfig`.** The `/runtime` entry documents
  that it does not depend on `lib.dom` (structural types only); the compiler
  now enforces that instead of relying on discipline.

- **The contract JSDoc of `cssFileAssetNames`** claimed a length mismatch
  "silently disables the fallback for the tail" — in fact registration raises
  `InvalidProviderError('css-files-length-mismatch')` (SPEC §4.2). The comment
  described behaviour the package left behind.

- **The `strictTokens` JSDoc** said it "forbids" overriding tokens unknown to
  the providers — it actually skips such an override with a `console.warn`
  while the build continues. The comment now states the real behaviour
  (`docs/{en,ru}` described it correctly all along).

## [0.7.0] — 2026-08-05

### Added

- **`granular doctor` now compares the declared dependency graph against what
  the provider actually ships.** Every import that lands in another component's
  directory without being reachable through `component.dependencies` is
  reported as `undeclared-dependency`.

  The gap it closes was silent in every other channel: a bundler never reads
  `dependencies`, so a missing edge costs the provider nothing at build time.
  The preset scans `components/<Name>/` and merges `safelist` only for
  components in the selection, so an application selecting just the outer
  component never scans the inner one — the nested component renders with no
  background and no focus ring. The provider builds, the types are intact, the
  app builds, and only whoever picked that particular selection ever sees it.

  Detection reads the emitted `.js` of the selected components and walks
  **through** the package's non-component files (`chunks/`,
  `groups/<group>/shared/`): `A → shared → B` is as much an edge as a direct
  import, and invisible if you only look at direct ones.

- `DoctorReport.undeclaredDependencies` and the exported type
  `DoctorUndeclaredDependency` (from `./node`).
- A "Undeclared dependencies" section in the `doctor` text report.

### Changed

- **Breaking (report types):** `DoctorDiagnosticCode` gained
  `'undeclared-dependency'`. An exhaustive `switch` with a `never` branch over
  this union stops compiling. Treat it as an open union.
- **Breaking (report types):** `DoctorReport` gained the required field
  `undeclaredDependencies`. Code that constructs a `DoctorReport` by hand (a
  test mock) stops compiling. Take the report from `granularDoctor` instead.
- **Breaking (behaviour):** `report.clean` can now be `false` where it was
  `true`. `report.ok` is unaffected — the new diagnostic is `warn`, so a
  default `doctor` run still exits `0`, but `doctor --strict` in CI will go red
  on a provider whose graph has drifted. That is a real finding, not an API
  break.
- The `dependencies` criterion is now written down where it is actually needed:
  in the JSDoc of both contract types (`DefineGranularComponentOptions` had no
  JSDoc at all), as a normative **MUST** in `docs/SPEC.md` §4.1, and as a
  "`dependencies` — critical" block in `docs/{en,ru}/component-authoring.md`.
  Previously the only statement of intent lived in one table cell — "only
  components your template truly depends on" — which is both too narrow (an
  import from `<script setup>`, a composable or a dynamic `import()` is just as
  much an edge) and silent about the converse: importing a constant or a type
  from another component's directory is **not** a dependency, and declaring it
  ships the donor's entire CSS and safelist to every consumer.

### Notes on the check

- **It ignores the current selection for targets, not for sources.** A target
  may happen to be selected for another reason — the CSS of that build is then
  correct, but the declaration is still wrong and the next consumer pays. Were
  it selection-aware, `components: 'all'` would never report anything. Sources,
  however, are the selected components only: as a provider author, run `doctor`
  with `components: 'all'`.
- **Level is `warn`, not `error`, because the finding is heuristic** — a
  regular expression over the text of the bundle, not an AST. That is not a
  safety net: `--strict` fails on a `warn` exactly as on an `error`.
- **Known limits, deliberately fixed rather than left to guesswork:** `.cjs` is
  not scanned at all (`require()` is not parsed, and a silent zero is worse
  than an honest "not checked"); a dynamic `import()` with a template string is
  not resolved; a specifier inside a string literal is counted as an import.
  Cross-package edges are matched at one deterministic position — right after a
  `components` segment, otherwise the first segment — so a path like
  `@pkg/utils/Button/…` no longer yields an edge and the result no longer
  depends on the order of `provider.components`.

### Migration

No action for provider or application code. Two things to check:

1. If you read `DoctorReport` from code, see the breaking notes above.
2. Run `granular doctor --strict` with `components: 'all'` against your
   provider before publishing. A reported edge that renders nothing is a false
   positive, not a missing dependency — do not declare it.

## [0.6.2] — 2026-08-04

### Added

- Typography support in the bundled extra rules.

## [0.6.1] — 2026-08-04

### Added

- `includeExtraRules` option for opting into `@feugene/unocss-mini-extra-rules`
  from the preset.

### Changed

- Dependency updates.

## [0.6.0] — 2026-08-03

### Added

- `granularCssAssetsPlugin` in the `./vite` entry, for CSS assets declared by a
  provider.

### Changed

- README rewritten around installation, usage and migration.

## [0.5.0] — 2026-07-30

A large release; the preset became a tool rather than just a preset.

### Added

- `granular explain` and `granular why-css` alongside `doctor`, with structured
  reports (`ExplainReport`, `WhyCssReport`).
- `tokenDefinitionsRef` — theme tokens by reference to a CSS custom property
  block, resolved in the node layer.
- `resolvePackageBaseUrl()` — the safe way to compute `packageBaseUrl`
  (`new URL('..', import.meta.url)` is rewritten to a `data:` URL by rolldown,
  which silently collapses the scan).
- App-owned themes and runtime theme switching, exercised end-to-end by the
  reference apps.

### Changed

- Layers restructured, the `./vite` entry expanded.
- Provider validation moved into `expandProviders` with typed errors.
- Caching of resolution, scan inspection and CSS reads keyed on options
  identity.

## [0.4.0] — 2026-07-17

### Added

- `granular doctor` — the first diagnostic command: providers, the selected
  component graph, theme token blocks, token conflicts, scan globs and
  layout-contract violations.
- `expandDirectives` option for the preflight CSS.
- Runtime debugging via `DEBUG` (`createDebug`).

### Changed

- Stricter provider validation.

## [0.3.0] — 2026-05-05

### Added

- The group-shared SFC contract: `<packageBaseUrl>/groups/<group>/shared/` is
  scanned for components declaring `group`.

### Changed

- `safelist` in the component contract is now optional.

## [0.2.3] — 2026-05-05

### Removed

- **Breaking (contract):** the deprecated `sourceDir` / `sourceDirUrl` options
  of the component contract. Component sources are located through the layout
  contract (`components/<Name>/`), not by a declared path.

## [0.2.0] — 2026-04-22

### Added

- Component-level theme token overrides (`tokenDefinitions` on a descriptor).

## [0.1.1] — 2026-04-21

### Added

- `granularChunkFileNames()` in the `./vite` entry — routes a provider's SFC
  chunks into `components/<Name>/chunks/`, without which the component's own
  classes never reach the final CSS.

## [0.1.0] — 2026-04-20

Initial release: the `GranularProvider` contract (`GRANULAR_CONTRACT_VERSION`
`1`), the browser preset, the node layer with filesystem scanning and CSS
reading, and theme/token assembly.
