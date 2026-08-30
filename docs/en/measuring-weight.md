# Measuring CSS/JS weight

> 🇷🇺 Русская версия: [`../ru/measuring-weight.md`](../ru/measuring-weight.md).

The preset promises an application pays only for the components it selected.
This document is about checking that with numbers rather than on trust.

## Why

"A component costs N kilobytes" means nothing without a denominator. Hence
three stands in this repository, each one step apart from the previous, and
the difference between their bundles is the price you are looking for.

Measured separately is something nobody counted before: how many CSS custom
properties reach the bundle, and how many of them are actually consumed.

## Three stands

| stand | what is in it | what it measures |
|---|---|---|
| `apps/bench-zero` | bare Vue, no preset, no package | the zero mark |
| `apps/bench-one` | + the preset and one component | the price of adoption |
| `apps/bench-pruned` | the same plus `pruneTokens.mode: 'on'` | the effect of trimming |

The build scaffolding of all three is deliberately identical: otherwise the
difference stops being a difference of the library.

## Asset layout

To attribute bytes to a layer, the layers are split into separate files.
Chunks — through code-splitting groups:

```ts
build: {
  rolldownOptions: {
    output: {
      codeSplitting: {
        groups: [
          { name: 'reset', test: /node_modules[\\/]@unocss[\\/]reset[\\/]/, priority: 1 },
          { name: 'hpkg', test: (id) => id.startsWith(pkgDistDir), priority: 2 },
          { name: 'vue', test: /node_modules[\\/](?:vue|@vue)[\\/]/, priority: 3 },
        ],
      },
    },
  },
}
```

CSS — through three separate dynamic imports:

```ts
await Promise.all([
  import('./reset'), // '@unocss/reset/tailwind-compat.css' → reset-*.css
  import('./granular'), // 'virtual:uno:granular.css'          → granular-*.css
  import('./app'), // 'virtual:uno.css'                   → app-*.css
])
```

That yields six roles: `vue`, `reset`, `granular` (foundation and component
CSS), `app` (utilities), `pkg` (component code), `entry`.

## Running

```bash
yarn build:all
yarn sizes         # report: bench-one against bench-zero, bench-pruned against bench-one
yarn sizes:json    # the same, machine readable
yarn sizes:check   # strict comparison against each stand's expected-budget.mjs
```

## What the report prints

```text
BY ROLE, gzip — bench-pruned against bench-one

  role             bench-one  bench-pruned         Δ
  granular             1 936         1 156      −780
  total               29 855        29 078      −777
  without vue          6 599         5 822      −777

TOKENS  --xh-
  declared in the bundle                  117
  reachable from real consumption          49
  dead weight                              68   (58 %)
```

The "without vue" line is what you actually pay: the framework runtime ships
with or without the library.

## Tokens: declared versus consumed

A flat count of `var(` is not enough here. A derived role references another
one, and a token reachable only from the value of a dead token is dead too:

```css
:root {
  --soft: color-mix(in oklab, var(--danger) 18%, var(--bg));
}
```

If nothing consumes `--soft`, then `--danger` does not become alive either. So
the tool builds a graph "token → tokens inside its value", seeds it only with
consumption OUTSIDE custom property values, and walks it. The report prints
both numbers and the difference on its own line.

The second channel is JS: a token name often sits there as a plain string.

```ts
const zVar = '--xh-z-dropdown'
const z = `var(${zVar})` // `var(--xh-z-dropdown)` never appears in the sources
el.style.setProperty('--xh-alert-bg', color)
```

The tool looks for such names too — in CSS, in JS chunks and in the markup.

## Classes: evidence of use

"The class is in the CSS but not in the JS" is not evidence: `p-6` coming from
`padding="lg"` physically cannot appear as a string. Hence separate verdicts:

| channel | evidence? |
|---|---|
| whole token inside `class="…"` of the markup | yes |
| whole token inside a JS string literal | yes |
| class declared by the package's own CSS | a separate bucket |
| only a literal prefix found (`"p-"`) | no, "probably" |
| nothing | not proven |

Exactly one verdict is unambiguous — **a `safelist` entry produced no CSS at
all**: the class was asked for, no rule exists, no selector is in the bundle.

## JSON

```json
{
  "stand": "bench-pruned",
  "roles": { "granular": { "gzip": 1156, "delta": { "gzip": -780 } } },
  "tokens": { "declared": 49, "reachable": 49, "unused": [] },
  "safelist": { "dead": ["shadow-legacy"], "unproven": ["p-2", "p-3", "p-4"] }
}
```

## What the measurement does not prove

- **The real weight for a consumer.** It measures the marginal price of the
  FIRST component: the foundation is paid once.
- **Weight after production compression.** `zlib` parameters here are not CDN settings.
- **That an "unproven" class is redundant.** Only removing the entry and
  looking at a live page can prove that.
- **That an "unused" token is redundant for the package.** The verdict is
  always about THIS application with THIS selection.
- **Rendering correctness.** Not a single visual check: CSS that shrank
  because a theme stopped being inlined looks like a win in the report.

## Why there is no byte gate

A gzip threshold is not reproducible across environments: the same tree yields
different numbers on macOS and on a Linux runner. And a threshold picked out of
thin air starts going red on honest growth, and people learn to raise it blindly.

Only boolean facts are gated therefore: a `safelist` entry produced no CSS; a
token is consumed without a fallback and declared nowhere; an asset was not
recognised by the classifier. Bytes go to the output and to the run summary.
