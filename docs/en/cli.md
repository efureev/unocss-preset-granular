# The `granular` CLI

The preset ships one executable, `granular`, declared as `bin` in
`@feugene/unocss-preset-granular`. It has three subcommands: `doctor` prints
what the preset actually sees (providers, the transitive component graph, theme
token blocks, token conflicts, scan globs and layout-contract violations),
`explain` answers why a particular component ended up in the build, and
`why-css` answers which component pulled a particular class into the CSS.

> 🇷🇺 Русская версия: [`../ru/cli.md`](../ru/cli.md).

Run it through the package manager (no global install needed):

```bash
npx granular doctor  ./granular.options.mjs [--json] [--strict]
npx granular explain ./granular.options.mjs '@your/pkg:XButton' [--json]
npx granular why-css ./granular.options.mjs 'text-red-500' [--json]
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

Провайдеры (1):
  • @feugene/simple-package — компонентов: 7

Выбранные компоненты (1, порядок = deps → зависящие):
  • @feugene/simple-package:XTest1

Темы: [light] (фолбэк ядра)

Скан-globs (1):
  • /abs/path/packages/simple-package/dist/components/XTest1/**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx,vue}

✓ OK — нарушений layout-контракта не найдено.
```

> **Note:** the report text is Russian — it is the package's working language.
> The structure is stable and the identifiers (provider ids, component names,
> selectors, paths) are not translated, so the output stays readable either
> way. For programmatic use take `--json` or the structured `DoctorReport`
> instead of parsing this text; see [Programmatic access](#programmatic-access).

Section by section:

| Section | What it tells you |
|---|---|
| `Провайдеры` — providers | Every resolved provider, how many components it **declares** (not how many you selected), whether it ships a `theme` section and whether it contributes `unocss` rules. |
| `Выбранные компоненты` — selected components | The transitive closure of `options.components`, in the order the preset emits them: **dependencies before dependents** (post-order DFS). Per entry: `deps`, `safelist` size, `cssFiles` count, `group`. |
| `Темы` — themes | The active theme list and, in parentheses, **where the list came from**: `themes.names`, the keys of `themes.define`, providers' `defaultThemes`, or the core fallback. Then one line per token block: theme → selector → token count. |
| `Конфликты токенов` — token conflicts | Only printed when non-empty. See below. |
| `Незаявленные зависимости` — undeclared dependencies | Only printed when non-empty. See below. |
| `Скан-globs` — scan globs | The exact globs handed to UnoCSS `content.filesystem`. If a class from a component source never reaches your CSS, this is the first place to look. |
| `Проблемы layout-контракта` — layout violations | Only printed when non-empty. See below. |
| `Итоги диагностики` — diagnostics summary | Every finding in one list, with its level and machine-readable code. Only printed when non-empty. |

### Token conflicts

A conflict is a token whose value is written by **more than one layer**. That
is legal and often intentional — the priority chain is
`provider → component → app override` — but it is also how a token silently
stops doing what you expect. `doctor` lists every such token with the chain of
sources and the value that won:

```text
Конфликты токенов (1) — значение задаётся несколькими слоями:
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
Незаявленные зависимости (1) — импорт есть в dist, в dependencies нет:
  • @your/pkg:XSidebar → @your/pkg:XButton ("../../XButton/chunks/XButton-DCi4.js" в chunks/XSidebar-Esxe.js)
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
Скан-globs (0):

⚠ Проблемы layout-контракта (1):
  • @feugene/simple-package:XTest1 — директория отсутствует (/abs/path/components/XTest1/)

✗ Найдены нарушения layout-контракта: 1.
```

Three reasons are distinguished: `директория отсутствует` (no directory),
`нет index.js` (directory without an entry) and `некорректный packageBaseUrl`
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

`ok` in the report means "no `error` at all", `clean` means "nothing at all".
By default `doctor` only fails on an `error`; `--strict` makes it fail on
warnings too:

```text
Итоги диагностики (ошибок: 0, предупреждений: 2):
  ⚠ [theme-warning] p:night — p объявил "night" в defaultThemes, но не поставляет её (нет ни themes[name], ни tokenDefinitions[name])
  ⚠ [token-conflict] light:primary — :root { --primary } задаётся несколькими слоями (provider:p → app-override), победило red

✓ OK — нарушений layout-контракта не найдено; предупреждений: 2 (падают только с --strict).
```

### `--json`

All three commands take the flag: it prints the same report as a structure, so
you never have to parse the text. The shape is exactly `DoctorReport` /
`ExplainReport` / `WhyCssReport` from `/node`:

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

Статус: в сборке — притянут как зависимость

Цепочка от корня селекции:
  @your/pkg:XCard → @your/pkg:XBase

Зависимости (0):

От него зависят (1):
  • @your/pkg:XCard

Даёт сборке:
  safelist (1): base-cls
  cssFiles (1):
    • file:///abs/path/base.css (asset: base.css)
  токены (1 тем(ы)):
    • [light] :root
        --x-color: #000 (перебит → #fff)

Скан-директории (1):
  • /abs/path/packages/pkg/dist/components/XBase
```

What matters here:

- **The chain** is the shortest path from a selection root. A component listed
  in `options.components` directly has a chain of one.
- **`перебит → …`** ("overridden") on a token means a higher layer rewrote the
  component's value — another component, `themes.define` or `tokenOverrides`.
- **`дедуплицирован в …`** ("deduplicated into") on a `cssFiles` entry means
  another component declared the same URL first, so the file is emitted under
  its name (dedup goes by URL).
- **No scan directories** is the same layout contract as in `doctor`; the
  reason is printed on its own line.

A component outside the selection is a valid answer (`НЕ в сборке` — not in the
build) and exits `0`. Only an unknown name exits `1`, printing the known ones.

## `why-css` — who pulled the class in

The reverse question: the class is in the CSS and it is not obvious why. The
command checks all three channels a class can arrive through:

```bash
npx granular why-css ./granular.options.mjs x-sp-test
```

```text
granular why-css x-sp-test
==========================

Источники (1):
  исходник компонента в content.filesystem:
    • @feugene/simple-package:XTest1 — dist/components/XTest1/chunks/XTest1-86x1RTRg.js

Просмотрено: CSS-файлов 0, исходников 2 в 1 директории(ях).
```

- `safelist компонента` — the class is declared in `safelist`, so the utility
  is always emitted even if the class appears in no source at all;
- `селектор в CSS-файле компонента` — the class arrives as a ready-made rule
  from `cssFiles` (CSS escaping such as `.hover\:bg-red` is handled, so search
  by the original class name);
- `исходник компонента в content.filesystem` — the class was found in files the
  extractor sees; the extension set is the scan's own (honouring
  `scan.extensions` / `scan.replaceExtensions`).

Nothing found exits `1`. That is not necessarily an error: the class may come
from `rules`/`shortcuts` of UnoCSS itself or of a provider, from base/tokens/a
theme CSS file, or from your application code — those sources are invisible to
the command. As a CI assertion ("this class no longer comes from the package")
the exit code does the job.

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
  granularWhyCss,
} from '@feugene/unocss-preset-granular/node'
import granularOptions from './granular.options.mjs'

const report = granularDoctor(granularOptions) // structured DoctorReport
console.log(formatDoctorReport(report)) // the text shown above

if (!report.ok)
  throw new Error(`layout contract violated: ${report.scan.missing.length}`)

granularExplain(granularOptions, '@your/pkg:XButton') // ExplainReport
await granularWhyCss(granularOptions, 'text-red-500') // WhyCssReport (reads files)
```

`granularDoctor` and `granularExplain` resolve through the same memoized
pipeline as the preset itself, so passing the object your `uno.config.ts`
already holds costs nothing beyond the directory checks — and guarantees the
report describes the build you actually ship, not a second, separately
resolved one.

The types (exported from `/node`): `DoctorReport` has `providers`,
`components`, `themes` (`names`, `namesSource`, `blocks`, `warnings`),
`tokenConflicts`, `undeclaredDependencies`, `scan` (`globs`, `dirs`, `missing`),
`diagnostics` and the booleans `ok` / `clean`; `ExplainReport` has `reason`, `chain`, `requiredBy`,
`safelist`, `cssFiles`, `tokens`, `scanDirs`; `WhyCssReport` has `hits`,
`scanned`, `found`.

### Report stability

The reports **grow in minor versions**: new fields and new diagnostic codes are
added without a major bump. What that means if you consume them from code:

- `DoctorDiagnosticCode` is an **open** union. Do not write an exhaustive
  `switch` with a `never` branch over it — it will stop compiling on an
  upgrade. Handle the codes you know and let a default branch take the rest.
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
