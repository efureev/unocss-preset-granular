# `@feugene/heavy-package`

Fixture `GranularProvider` package with a **full design-system foundation**:
`tokens.css`, `base.css` and `light`/`dark` theme files declared at provider
level. It is the only package in this repository that carries a package-level
`theme`.

> **This is a fixture, not a template.** Its content is chosen so that every
> construct which can break token analysis or token pruning appears at least
> once — not so that it looks like a real design system.

## Why it exists

`simple-package` proves the contract is implementable; `extra-simple-package`
proves providers compose. Neither declares a `theme`, so neither reproduces the
case this package exists for: an application that selects one component still
receives the **entire** foundation, because `tokensCssUrl` / `baseCssUrl` /
`themes[name]` are inlined whole, regardless of selection.

The measuring stands `apps/bench-zero` and `apps/bench-one` are built on it.

## Foundation

| file | declarations | what it carries |
|---|---:|---|
| `src/theme/tokens.css` | 52 | theme-independent scales: spacing, radii, typography, weights, z-index, motion, shadows, borders, containers |
| `src/theme/light.css` | 64 | raw palette (30), semantic roles (15), component roles (12), derived `color-mix` roles (5), plus `@supports` fallbacks |
| `src/theme/dark.css` | 64 | same names under `[data-theme='dark'], .dark` |
| `src/theme/base.css` | 0 | global reset and typographic defaults — rules only |

117 unique token names in total.

### Deliberate edge cases

`tokens.css` and the theme files carry, on purpose:

- derived roles through `color-mix(in oklab, var(--xh-accent) 92%, var(--xh-fg))`
  — a reference chain any reachability analysis must walk;
- a role referencing a role (`--xh-invalid-brd: var(--xh-danger)`);
- `--radius`, a token **without** the package prefix — a prefix is not a
  criterion for ownership;
- `@supports not (color: color-mix(…))` fallback blocks declaring the same
  names. A flat block parser skips at-rules, so anything that rewrites these
  files must walk into them;
- a multi-line value with commas and nested parentheses (`--xh-shadow-md`);
- `;` inside a quoted string (`--xh-quote-sep`) and inside
  `url(data:…;base64,…)` (`--xh-dot`);
- a comment between the name and `:` (`--xh-gap`);
- a guaranteed-invalid empty value (`--xh-empty`);
- a final declaration with no trailing `;` (`--xh-tabular`);
- `--xh-fg-boost` declared **only** in `light`, referenced by
  `--xh-elevated-fg` declared **only** in `dark`. A keep-set computed per theme
  drops the first and silently breaks the second.
- `--xh-z-dropdown`, whose name is assembled at runtime from a shared module
  the bundler emits as `dist/internal/overlayZ.js` — outside every scanned
  directory. This reproduces `@feugene/granularity`'s
  `composables/internal/overlayStack.ts` exactly. `XhOverlay` declares it in
  `dynamicTokens`; strip that declaration and the token is dropped (verified
  A/B, and `granular prune` reports it as a suspect).

## Components

| component | channel it exercises |
|---|---|
| `XhCard` | static classes only, empty `safelist` — the control case |
| `XhButton` | `safelist` of two kinds: `p-${n}` steps (needed, never a whole string in the bundle) and whole `TONE` strings (provable). Plus `shadow-legacy`, a deliberately dead entry |
| `XhAlert` | token names as object keys of an inline style, and `getPropertyValue('--xh-alert-duration')` — neither is visible to a `var(` scan |
| `XhOverlay` | `var()` assembled at runtime, with the name living in `components/shared/overlayZ.ts` — a module emitted **outside** any scanned directory. No static channel can see it; only `dynamicTokens` on the component saves the token |
| `XhPanel` | `dependencies` on the four above, plus the only declared `cssFiles` in the package |
| `XhTable`, `XhList` | `group: 'data'` with a shared SFC; **never selected** — negative control |

## Packaging warning

`baseCssUrl` / `tokensCssUrl` / `themes[name]` have **no `assetName` fallback**,
unlike `cssFiles` and component-level `tokenDefinitionsRef`. They must be
written as `new URL(…, import.meta.url)` literals, and the bundler then inlines
each file into `dist/granular-provider.js` as a `data:text/css;base64` URL —
which is why that entry is ~17 kB here.

That is acceptable **only** because the provider entry never reaches a client
bundle. A real design system should weigh this trade-off explicitly.

## Commands

```bash
yarn workspace @feugene/heavy-package build
```
