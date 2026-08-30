# The `granular` CLI

The preset ships one executable, `granular`, declared as `bin` in
`@feugene/unocss-preset-granular`. It has five subcommands: `doctor` prints
what the preset actually sees (providers, the transitive component graph, theme
token blocks, token conflicts, scan globs and layout-contract violations),
`explain` answers why a particular component ended up in the build,
`why-css` answers which component pulled a particular class into the CSS,
`tokens` answers which theme tokens a component declares and consumes, and
`prune` answers which token declarations nothing in the build consumes.

> 🇷🇺 Русская версия: [`../ru/cli.md`](../ru/cli.md).

Run it through the package manager (no global install needed):

```bash
npx granular doctor  ./granular.options.mjs [--json] [--strict]
npx granular explain ./granular.options.mjs '@your/pkg:XButton' [--json]
npx granular why-css ./granular.options.mjs 'text-red-500' [--json]
npx granular tokens  ./granular.options.mjs 'XButton' [--deep] [--json]
npx granular prune   ./granular.options.mjs [--json] [--strict]
```

## The options file

Every command needs your granular options, and they normally live inside
`uno.config.ts` — a file the CLI cannot import on its own. So the CLI takes a
path to a **separate module** that exports them.

The module must be something Node can `import()` (`.js` / `.mjs`), and it must
export the options under one of three names — `default`, `granularOptions` or
`options`:

```js
// granular.options.mjs
import provider from '@your/pkg/granular-provider/node'

export default {
  providers: [provider],
  components: [{ provider: '@your/pkg', names: ['XButton'] }],
}
```

Anything else fails fast: a module that exports no recognised name, or whose
options have no `providers` array, is reported as a usage error rather than
producing an empty report.

Keeping the options in their own module is worth doing regardless of the CLI —
the app then passes **one and the same object** to `presetGranularNode()` and
`granularContent()`, which is what the preset's caches key on. See
[Usage in applications](./usage-in-apps.md).

## `doctor` — reading the report

A healthy run on a one-component app:

```text
granular doctor
===============

Providers (1):
  • @feugene/simple-package — components: 7

Selected components (1, order = deps → dependents):
  • @feugene/simple-package:XTest1

Themes: [light] (source: core fallback)

Scan globs (1):
  • /abs/path/packages/simple-package/dist/components/XTest1/**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx,vue}

✓ OK — no layout-contract violations.
```

> **Note:** the structure of the text report is stable, but for programmatic
> use take `--json` or the structured `DoctorReport` instead of parsing this
> text; see [Programmatic access](#programmatic-access).

Section by section:

| Section | What it tells you |
|---|---|
| `Providers` | Every resolved provider, how many components it **declares** (not how many you selected), whether it ships a `theme` section and whether it contributes `unocss` rules. |
| `Selected components` | The transitive closure of `options.components`, in the order the preset emits them: **dependencies before dependents** (post-order DFS). Per entry: `deps`, `safelist` size, `cssFiles` count, `group`. |
| `Themes` | The active theme list and, in parentheses, **where the list came from**: `themes.names`, the keys of `themes.define`, providers' `defaultThemes`, or the core fallback. Then one line per token block: theme → selector → token count. |
| `Token conflicts` | Only printed when non-empty. See below. |
| `Undeclared dependencies` | Only printed when non-empty. See below. |
| `Scan globs` | The exact globs handed to UnoCSS `content.filesystem`. If a class from a component source never reaches your CSS, this is the first place to look. |
| `Layout-contract problems` | Only printed when non-empty. See below. |
| `Diagnostics summary` | Every finding in one list, with its level and machine-readable code. Only printed when non-empty. |

### Token conflicts

A conflict is a token whose value is written by **more than one layer**. That
is legal and often intentional — the priority chain is
`provider → component → app override` — but it is also how a token silently
stops doing what you expect. `doctor` lists every such token with the chain of
sources and the value that won:

```text
Token conflicts (1) — the value is written by several layers:
  • [light] :root { --x-tokenized } ← component:XTokenized → app-override = #34d399
```

Sources are shown in application order and named `provider:<id>`,
`component:<Name>`, `app-theme` (a theme declared by the app via
`themes.define`) or `app-override` (`themes.tokenOverrides`).

### Undeclared dependencies

`component.dependencies` is what a provider **declares**; its build output is
what it actually **ships**. Nothing keeps the two in sync — a provider's bundler
does not read `dependencies` at all — so they drift silently. `doctor` reads the
emitted code of each selected component and reports every import that lands in
another component's directory without being reachable through the declared
graph:

```text
Undeclared dependencies (1) — the import is in dist, not in dependencies:
  • @your/pkg:XSidebar → @your/pkg:XButton ("../../XButton/chunks/XButton-DCi4.js" in chunks/XSidebar-Esxe.js)
```

Why it matters: the preset scans `components/<Name>/` only for components in the
selection. An app that selects `XSidebar` alone therefore never scans
`XButton`'s directory and never gets its safelist — the button rendered inside
the sidebar comes out with no background and no focus ring. Nothing fails: the
provider builds, the types are intact, the app builds, and the defect surfaces
only in the browser of whoever picked that particular selection.

The check deliberately **ignores the current selection** — as far as TARGETS
go. The target component may well be selected for another reason, and then this
build's CSS is correct, but the declaration is still wrong and the next consumer
pays for it. Were it selection-aware, the most common configuration
(`components: 'all'`) would never report anything. SOURCES, however, are the
selected components only: as a provider author, run `doctor` with
`components: 'all'`, or you will have checked nothing but your own selection's
closure.

Relative imports inside the package are recognised — including those that go
through a shared chunk (`chunks/`, `groups/<group>/shared/`): the path
`A → shared → B` is as much an edge as a direct import, and `source` in the
report points at the file where the import is actually written. Cross-package
edges are recognised through bare specifiers of the form
`<providerId>/components/<ComponentName>` (or `<providerId>/<ComponentName>`);
that relies on the convention that a provider's `id` is its npm package name,
and silently skips the edge when it is not.

### What the check cannot see

The parsing is a regular expression over the text of the bundle, not a parser,
and `dist` is read without being executed. Hence a list of what is knowingly out
of scope:

- **CJS output.** `require()` is not recognised, and `.cjs` is not read at all —
  so that an empty result never looks like a clean bill of health. The granular
  layout contract assumes ESM (`components/<Name>/index.js`).
- **Dynamic `import()` with a template string** (`` import(`../${n}.js`) ``) —
  the target is unknown until runtime.
- **Imports-as-data.** A specifier inside a string literal is counted as an
  import. Not something real bundles contain, but possible.
- **Components outside the selection** as sources — see `components: 'all'`
  above.

And the converse, which the check cannot tell apart: importing a **constant, a
type or a helper** from another component's directory looks exactly like
importing the component. If a reported edge renders nothing, it is a false
positive rather than a missing dependency — declaring it ships the donor's
entire CSS and safelist to every consumer of yours.

The level is `warn`, not `error`, for one reason: the finding is **heuristic**
(see the list above), and a heuristic has no business issuing an unconditional
failure. This is not a safety net: `--strict`, recommended for CI right here,
fails on a `warn` exactly as it does on an `error`. The only difference is the
default behaviour — and that the finding moves `clean`, not `ok`.

### Layout-contract violations

Component scanning requires each selected component to have its own
`components/<Name>/` directory in the provider's build output. When one is
missing, the component's classes cannot be extracted from its source and
quietly vanish from the CSS — the build stays green. `doctor` is the check
that turns this into a failure:

```text
Scan globs (0):

⚠ Layout-contract problems (1):
  • @feugene/simple-package:XTest1 — directory is missing (/abs/path/components/XTest1/)

✗ Layout-contract violations found: 1.
```

Three reasons are distinguished: `directory is missing`,
`index.js is missing` (directory without an entry) and `invalid packageBaseUrl`
(the provider's base URL doesn't resolve — usually the `data:` URL trap). The
fix is almost always the `chunkFileNames` recipe in
[Authoring providers](./authoring-providers.md).

### Diagnostic levels and `--strict`

Every finding in the report is also collected into a flat `diagnostics` list
with two levels. The criterion is one: **must this break the build**.

| Code | Level | What it means |
|---|---|---|
| `layout-contract` | `error` | A component is out of the scan — its classes silently vanish from the CSS. |
| `theme-warning` | `warn` | A theme-resolution warning: `defaultThemes` without a source, a partial theme, a broken `extends`, several default themes at once. |
| `token-conflict` | `warn` | A token is written by more than one layer. |
| `unused-provider` | `warn` | A provider contributed nothing: no selected components, no `theme`, no `unocss`. |
| `undeclared-dependency` | `warn` | A built component imports another one without declaring it — its classes vanish for anyone who selects it alone. |
| `token-prefix` | `warn` | A token key is declared **with** the `--` prefix — the generator adds it itself, so the CSS gets a valid but useless `----x` and the theme silently loses the value. |
| `token-undefined` | `warn` | A component consumes a token no granular layer defines. Heuristic in the same way `undeclared-dependency` is: the token may still come from outside granular. |

`ok` in the report means "no `error` at all", `clean` means "nothing at all".
By default `doctor` only fails on an `error`; `--strict` makes it fail on
warnings too:

```text
Diagnostics summary (errors: 0, warnings: 2):
  ⚠ [theme-warning] p:night — p lists "night" in defaultThemes but does not supply it (neither themes[name] nor tokenDefinitions[name])
  ⚠ [token-conflict] light:primary — :root { --primary } is written by several layers (provider:p → app-override), final value: red

✓ OK — no layout-contract violations; warnings: 2 (they only fail with --strict).
```

### `--json`

All four commands take the flag: it prints the same report as a structure, so
you never have to parse the text. The shape is exactly `DoctorReport` /
`ExplainReport` / `WhyCssReport` / `TokensReport` from `/node`:

```json
{
  "providers": [{ "id": "@your/pkg", "components": 7, "hasTheme": false, "hasUnocss": false }],
  "diagnostics": [{ "level": "warn", "code": "unused-provider", "subject": "@other/pkg", "message": "…" }],
  "ok": true,
  "clean": false
}
```

## `explain` — why a component is in the build

Answers "where did this come from and what does it bring". The component name
can be fully qualified (`providerId:Name`) or short — the short form is
accepted as long as it is unambiguous:

```bash
npx granular explain ./granular.options.mjs XCard
```

```text
granular explain @your/pkg:XBase
================================

Status: in the build — pulled in as a dependency

Chain from the selection root:
  @your/pkg:XCard → @your/pkg:XBase

Dependencies (0):

Required by (1):
  • @your/pkg:XCard

Contributes to the build:
  safelist (1): base-cls
  cssFiles (1):
    • file:///abs/path/base.css (asset: base.css)
  tokens (1 theme(s)):
    • [light] :root
        --x-color: #000 (overridden → #fff)

Scan directories (1):
  • /abs/path/packages/pkg/dist/components/XBase
```

What matters here:

- **The chain** is the shortest path from a selection root. A component listed
  in `options.components` directly has a chain of one.
- **`overridden → …`** on a token means a higher layer rewrote the
  component's value — another component, `themes.define` or `tokenOverrides`.
- **`deduplicated into …`** on a `cssFiles` entry means
  another component declared the same URL first, so the file is emitted under
  its name (dedup goes by URL).
- **No scan directories** is the same layout contract as in `doctor`; the
  reason is printed on its own line.

A component outside the selection is a valid answer (`NOT in the build`) and
exits `0`. Only an unknown name exits `1`, printing the known ones.

## `why-css` — who pulled the class in

The reverse question: the class is in the CSS and it is not obvious why. The
command checks all three channels a class can arrive through:

```bash
npx granular why-css ./granular.options.mjs x-sp-test
```

```text
granular why-css x-sp-test
==========================

Sources (1):
  component source in content.filesystem:
    • @feugene/simple-package:XTest1 — dist/components/XTest1/chunks/XTest1-86x1RTRg.js

Scanned: 0 CSS file(s), 2 source file(s) in 1 director(ies).
```

- `component safelist` — the class is declared in `safelist`, so the utility
  is always emitted even if the class appears in no source at all;
- `selector in a component CSS file` — the class arrives as a ready-made rule
  from `cssFiles` (CSS escaping such as `.hover\:bg-red` is handled, so search
  by the original class name);
- `component source in content.filesystem` — the class was found in files the
  extractor sees; the extension set is the scan's own (honouring
  `scan.extensions` / `scan.replaceExtensions`).

Nothing found exits `1`. That is not necessarily an error: the class may come
from `rules`/`shortcuts` of UnoCSS itself or of a provider, from base/tokens/a
theme CSS file, or from your application code — those sources are invisible to
the command. As a CI assertion ("this class no longer comes from the package")
the exit code does the job.

## `tokens` — which tokens a component needs

`explain` answers where a component came from; `tokens` answers what it needs in
order to look right. It separates the component's **own** tokens from the
**shared** ones it merely consumes, shows the full chain of layers behind every
value, and names the tokens nobody defines.

```bash
npx granular tokens ./granular.options.mjs XTestStyled [--deep] [--json]
```

```text
granular tokens @feugene/simple-package:XTestStyled
===================================================

Status: in the build; scope: this component only (--deep adds sub-components)

Declares (0): —

Uses (4):
  from the application (2):
    • --brd  [safelist]
        [light] :root  app-override #02f8fa
        also used by (1): @feugene/simple-package:XTest1
    • --card-fg  [safelist]
        [light] :root  app-override #af172a
  not defined by any granular layer (2):
    ⚠ --card  [safelist] (no fallback)
    ⚠ --ds-radius-lg  [safelist] (no fallback)

Scanned: 6 safelist entr(ies), 0 CSS file(s), 13 source file(s) in 8 director(ies).
```

### Own tokens versus shared ones

`Uses` is grouped by **origin** — the bottom layer of the token's chain — and
the order of the groups *is* the answer to "which are mine and which are shared":

| Group | Origin | What it means |
|---|---|---|
| declared by this component | `own` | The component publishes it via `tokenDefinitions` and consumes it. |
| declared by another component | `component` | An implicit link through a token: someone else publishes it. |
| from the provider — design-system tokens | `provider` | `provider.theme.tokenDefinitions`, or its inlined `tokensCssUrl` / `baseCssUrl` / theme file — the shared palette. |
| from the application | `app` | `themes.define`, `themes.tokenOverrides`, or a file substituted through `themes.tokensFile` / `baseFile` / `themeFiles`. |
| not defined by any granular layer | `none` | Nobody defines it. See the caveat below. |

`also used by` lists the **other selected components** consuming the same token
— that is, who else a change to it would touch. It is always computed: the scan
walks every selected component in one pass anyway, so the marginal cost is zero.

### Values, layer by layer

Every value is printed as the chain that produced it, in application order,
so it is visible not just *what* the value is but *who* set it:

| Chain | Reading |
|---|---|
| `provider:@your/pkg #ccc → app-override #02f8fa` | the provider's default, overridden by the app |
| `component:XTokenized red` | a single layer — the component's own value |
| `provider '@your/pkg' 6px` (no arrows) | declared in an inlined CSS file, not by a structural layer |
| `app-override 8px (dropped by strictTokens) — not in the CSS` | the override was written but `strictTokens` discarded it |

The chain comes from the same function that emits the CSS, so it cannot report a
value the build does not produce.

### `--deep` — tokens of sub-components

Without the flag the report covers the component alone. `--deep` adds its
transitive `dependencies`, which answers "what does this component need
*including* everything it pulls in". Origin is always computed **relative to the
target**: a token published by a sub-component shows up as
`declared by another component`, which is exactly what the flag exists to
surface.

Parts living inside the component's own directory (`parts/`) are not
dependencies and never were — they are the component's own code, so their
tokens stay `own`.

### What the check cannot see

Consumption is found through three channels — `safelist` (pure resolution
data), `component-css` (declared `cssFiles`) and `source-scan` (component
sources in `content.filesystem`). The parsing is textual, so the limits are:

A token declared in inlined CSS (`tokensCssUrl`, `baseCssUrl`, a theme file)
carries a value but no layer chain: `tokenOverrides` will not reach it until the
provider promotes it with `tokenDefinitionsFromCss`. The report prints such a
value on its own line, without arrows.

- **Tokens in shared chunks outside the component directory.** If the component
  declares its classes in `safelist`, they are found there; if it does not, the
  UnoCSS extractor does not see them either, so the gap coincides with the CSS
  actually being absent.
- **Dynamically built names** (`` var(--${name}) ``) — unknown until runtime.
- **`var(--x)` inside a data string or a comment** counts as consumption.
- **`.cjs`** is not read, exactly as in the dependency check.

## `prune` — what the emitted CSS could drop

`tokens` answers a per-component question. `prune` answers one about the build
as a whole: which token declarations reach the CSS that nothing consumes.

The command **never changes the emission**. It reads the configuration and
prints the plan; the trimming itself is switched on by `pruneTokens.mode` in
the preset options — see [Themes and tokens](./themes-and-tokens.md).

```bash
npx granular prune ./granular.options.mjs [--json] [--strict]
```

```text
granular prune
==============

Mode: off
  (trimming is disabled — everything below is what it WOULD do;
   enable it with pruneTokens.mode in the preset options)
Providers: @feugene/heavy-package
Themes: light, dark

Files (4):
  • provider '@feugene/heavy-package' — theme/tokens.css — 52 declared, 19 kept, 33 removed   3.4 kB → 2.4 kB
  • provider '@feugene/heavy-package' — theme/base.css — not pruned (base: rules, not declarations)
  • provider '@feugene/heavy-package' — theme/light.css [light] — 64 declared, 29 kept, 35 removed   3.8 kB → 2.6 kB

Kept (49):
  consumed by a selected component (42):
    • --xh-accent
  used by rules of the inlined CSS (6):
    • --xh-bg
  referenced by another kept token (1):
    • --xh-fg-boost  ← --xh-elevated-fg

Removed (68): --xh-amber-100 --xh-amber-300 …

Total: 11.6 kB → 8.3 kB (-29%).
Application sources: not configured — the preset did not read a single file of this application.
```

### Reading the "Kept" groups

The group is the strongest reason the token survived, in this order: consumed
by a component, used by a component CSS file, used by rules of the inlined
CSS, found in the application sources, targeted by an override, declared by a
structural layer, kept by pattern, referenced by another kept token.

`referenced by another kept token` is the transitive closure: a derived role
written as `color-mix(…, var(--accent), …)` keeps `--accent` alive even when
nothing mentions it directly.

### The last line matters

`Application sources: not configured` means the preset read nothing of your
application. It sees provider components and does not see your markup, so a
`bg-[var(--brand)]` in `App.vue` is invisible to it. Switching `mode` to `'on'`
in that state is the most common way to lose a token silently.

### A pattern that matches nothing

```text
⚠ Patterns matching nothing declared (1):
    • @feugene/granularity:GrPopover → gr-z-dropdow
```

A typo in `keep` / `keepPrefixes`, or a `dynamicTokens` line left behind after
the component stopped assembling the name at runtime. It breaks nothing by
itself — which is exactly why it rots unnoticed.

Two things it deliberately does **not** report: a pattern matched by any token
counts as live even when another pattern covers the same one, and a declaration
on a component outside this selection is not a finding — it simply did not
apply to this build.

### Removed, but the name is assembled at runtime

```text
⚠ Removed, but the name appears as a literal outside the scanned directories (2):
    • --gr-z-dropdown  chunks/overlayStack-DH4Z7am1.js
    • --gr-z-modal     chunks/overlayStack-DH4Z7am1.js
```

The single case where trimming breaks silently: a shared module assembles
`var()` at runtime, the bundler hoisted it into a chunk outside
`components/<Name>/`, and no static channel can reach it. The fix is
`dynamicTokens` on the component that reads the token.

Two conditions keep this from becoming noise. The file must also assemble
`var()` — a name alone is not enough. And a token declared in `dynamicTokens`
by **any** component of the provider is never a suspect: it is declared, it
simply was not selected for this build.

A name alone is not enough to raise this — the file must also assemble `var()`.
Without that condition every removed token becomes a finding: a design system
normally ships a TS mirror of its token registry where each name sits as a
string. Measured on a real package: 195 findings out of 195 removed tokens
before the condition, 2 after.

### `--strict`

Exits 1 when anything would be removed. Useful as a gate of the shape "the
foundation is already clean": in a repository where trimming is on, a growing
removed list means a component stopped consuming a token — a style regression,
not a win.

## Exit codes

| Invocation | Output | Exit code |
|---|---|---|
| `granular doctor <file>` — no violations | report on stdout | `0` |
| `granular doctor <file>` — violations found | report on stdout | `1` |
| `granular doctor <file> --strict` — warnings present | report on stdout | `1` |
| `granular explain <file> <component>` — component known | report on stdout | `0` |
| `granular explain <file> <component>` — name unknown or ambiguous | report with the known names | `1` |
| `granular why-css <file> <class>` — a source was found | report on stdout | `0` |
| `granular why-css <file> <class>` — no source | report on stdout | `1` |
| `granular tokens <file> <component>` — component known | report on stdout | `0` |
| `granular tokens <file> <component>` — name unknown or ambiguous | report with the known names | `1` |
| `granular prune <file>` — plan printed | report on stdout | `0` |
| `granular prune <file> --strict` — something would be removed | report on stdout | `1` |
| any command — file missing, unimportable, or exporting no options | message on stderr | `1` |
| `granular help` / `--help` / `-h` | usage on stdout | `0` |
| `granular` with no arguments | usage on stdout | `1` |
| `granular <anything-else>` | usage on stderr | `1` |

Because a violation is an exit code and not just a warning, `doctor` drops
straight into CI, where it catches a provider that was published with a
flattened `dist/` before the broken CSS reaches anyone:

```bash
- run: npx granular doctor ./granular.options.mjs --strict
```

## Programmatic access

The same reports are available from the node entry, which is the better option
inside a Vite plugin, a test, or any script that wants to act on the result
rather than show it:

```ts
import {
  formatDoctorReport,
  granularDoctor,
  granularExplain,
  granularTokens,
  granularWhyCss,
} from '@feugene/unocss-preset-granular/node'
import granularOptions from './granular.options.mjs'

const report = granularDoctor(granularOptions) // structured DoctorReport
console.log(formatDoctorReport(report)) // the text shown above

if (!report.ok)
  throw new Error(`layout contract violated: ${report.scan.missing.length}`)

granularExplain(granularOptions, '@your/pkg:XButton') // ExplainReport
await granularWhyCss(granularOptions, 'text-red-500') // WhyCssReport (reads files)
granularTokens(granularOptions, '@your/pkg:XButton', 'deep') // TokensReport
```

`granularDoctor` and `granularExplain` resolve through the same memoized
pipeline as the preset itself, so passing the object your `uno.config.ts`
already holds costs nothing beyond the directory checks — and guarantees the
report describes the build you actually ship, not a second, separately
resolved one.

The types (exported from `/node`): `DoctorReport` has `providers`,
`components`, `themes` (`names`, `namesSource`, `blocks`, `warnings`),
`tokenConflicts`, `undefinedTokens`, `undeclaredDependencies`, `scan` (`globs`, `dirs`, `missing`),
`diagnostics` and the booleans `ok` / `clean`; `ExplainReport` has `reason`, `chain`, `requiredBy`,
`safelist`, `cssFiles`, `tokens`, `scanDirs`; `WhyCssReport` has `hits`,
`scanned`, `found`; `TokensReport` has `scope`, `components`, `declares`, `uses`,
`scanned`, `sourceScanActive`, `undefinedCount`.

### Report stability

The reports **grow in minor versions**: new fields and new diagnostic codes are
added without a major bump. What that means if you consume them from code:

- `DoctorDiagnosticCode` is an **open** union. Do not write an exhaustive
  `switch` with a `never` branch over it — it will stop compiling on an
  upgrade. Handle the codes you know and let a default branch take the rest.
- `TokenUsageVia` and `TokenKeepReason` are open in the same sense: channels
  and keep reasons are added as the analysis learns to see more.
- Report fields are **required**. If you build a `DoctorReport` by hand (a mock
  in tests), a new field breaks compilation — take the report from
  `granularDoctor` instead of assembling one yourself.
- A new `warn`-level code **moves `clean`, never `ok`**. A CI job on
  `doctor --strict` may go red after a minor upgrade; that is expected and
  means a real finding, not an API break.

`GRANULAR_CONTRACT_VERSION` has nothing to do with this: it versions the shape
of `GranularProvider`, not the CLI reports.

## See also

- [Troubleshooting & recipes](./troubleshooting.md) — the symptom-first list;
  most entries end at a `doctor` section.
- [Component scanning](./component-scanning.md) — what the scan globs mean and
  how they are computed.
- [Themes and tokens](./themes-and-tokens.md) — the priority chain behind the
  token-conflict report.
