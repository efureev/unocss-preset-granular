# `@feugene/unocss-mini-extra-rules`

Extra [UnoCSS](https://unocss.dev/) rules that extend
[`@unocss/preset-mini`](https://unocss.dev/presets/mini) with a few missing
pieces: spinner animation, bracketed color + opacity helpers, advanced
filter / backdrop‑filter utilities, Tailwind‑like `space-*` / `divide-*`
spacing, the `object-fit` / `object-position` and `text-transform` families
and the `sr-only` screen‑reader pair.

- ESM only, Node ≥ 22, TypeScript strict.
- `@unocss/core` stays a `peerDependency` (so the consumer's `Rule`/`Preset`
  types and the `@unocss/core` instance in their tree stay a single,
  consistent version); `@unocss/preset-mini` and `@unocss/rule-utils` are
  plain dependencies — only pure helpers are imported from them, and as peers
  they would fail to resolve under strict `node_modules` layouts.
- Tree‑shakeable: each group of rules is exported separately so you can
  import only what you need.
- No coupling to `@feugene/unocss-preset-granular` — usable in any UnoCSS
  setup based on `preset-mini` / `preset-wind*`.

## Why

`@unocss/preset-mini` and `@unocss/preset-wind*` do not ship a few utility
shapes that are convenient to have in real‑world apps:

- Spinner keyframes (`animate-spin`) without bringing in the whole
  `preset-wind` stack.
- `bg-[color]/NN` / `border-[color]/NN` syntax that combines a bracketed
  color value with an opacity percent via `color-mix(in srgb, …)`.
- `filter` / `backdrop-filter` utilities built on top of custom CSS
  properties (`--un-blur`, `--un-drop-shadow`, …) with support for
  `filter-*`, `backdrop-*` prefixes and `drop-shadow-color-*`
  colorisation.
- Tailwind‑compatible `space-x-*`, `space-y-*`, `space-*-reverse`,
  `divide-*` variant behaviour.
- `sr-only` / `not-sr-only`, without which visually hidden labels stay
  visible.
- The `object-fit` / `object-position` families, without which images
  silently stretch instead of being cropped, fitted or aligned.

This package bundles all of the above as small, composable `Rule[]` /
`Preflight[]` / `Variant[]` arrays.

## Install

```bash
yarn add -D @feugene/unocss-mini-extra-rules
# or
npm i -D @feugene/unocss-mini-extra-rules
# or
pnpm add -D @feugene/unocss-mini-extra-rules
```

Make sure UnoCSS and its mini preset are already installed in your
project:

```bash
yarn add -D unocss @unocss/preset-mini
```

## Quick start

```ts
// uno.config.ts
import { defineConfig } from 'unocss'
import presetMini from '@unocss/preset-mini'
import {
  animationRules,
  animationPreflights,
  colorOpacityRules,
  filterRules,
  spacingRules,
  spacingVariants,
} from '@feugene/unocss-mini-extra-rules'

export default defineConfig({
  presets: [presetMini()],
  rules: [
    ...animationRules,
    ...colorOpacityRules,
    ...filterRules,
    ...spacingRules,
  ],
  variants: [
    ...spacingVariants,
  ],
  preflights: [
    ...animationPreflights,
  ],
})
```

You can import any subset — e.g. only `spacingRules` / `spacingVariants` —
to keep the generated CSS minimal.

## What’s inside

### `animationRules`, `animationPreflights`

- `animate-spin` → `animation: granularity-spin 1s linear infinite`
- Preflight registers the `@keyframes granularity-spin` rule.

### `colorOpacityRules`

Allow combining a bracketed CSS color with an opacity percent using
`color-mix(in srgb, …)`:

- `bg-[var(--brand)]/50` → `background-color: color-mix(in srgb, var(--brand) 50%, transparent)`
- `bg-[color:#0ea5e9]/30`
- `border-[#ff0]/25`
- `bg-[oklch(70% 0.2 40)]/80`

The opacity part must be a number in `0..100` (fractional values
supported). Invalid colors / opacities simply do not match and fall
through to other rules.

### `filterRules`

Rewrites `@unocss/preset-mini` filter & backdrop‑filter utilities to use
custom CSS properties (`--un-blur`, `--un-brightness`, `--un-drop-shadow`,
…). This enables composing several filters on the same element:

```html
<div class="blur-4 brightness-110 drop-shadow-md drop-shadow-color-black/40" />
<div class="backdrop-blur-md backdrop-saturate-150 backdrop-op-80" />
```

Supported shapes (prefixes are optional — `filter-*`, `backdrop-*`):

- `blur(-*)`, `brightness-*`, `contrast-*`, `grayscale(-*)`,
  `hue-rotate-*`, `invert(-*)`, `saturate-*`, `sepia(-*)`
- `drop-shadow(-*)`, `drop-shadow-color-*`, `drop-shadow-op-*`
- `backdrop-op(acity)-*`

### `spacingRules`, `spacingVariants`

Tailwind‑style sibling spacing and divide utilities backed by the
`space-*` / `divide-*` variant:

- `space-x-4`, `space-y-2`, `space-x-[1rem]`
- `space-x-reverse`, `space-y-reverse`
- `divide-x`, `divide-y`, `divide-y-2`, `divide-x-reverse` — border widths
- `divide-[var(--brd)]`, `divide-red-500` — divider **colour**, resolved by
  `presetMini`'s own `colorResolver`, so theme colours, bracket values and the
  `/<opacity>` suffix behave exactly as they do for `border-*`

Both the width and the colour forms are scoped to the same
`>:not([hidden])~:not([hidden])` siblings — a colour rule without that
selector would paint the container's own border instead of the dividers.

Expressions inside `[]` support `calc()`‑friendly arithmetic (including
mixed units and CSS variables).

### `typographyRules`

The `text-transform` family, which lives in `presetWind*` and is absent from
`presetMini`:

- `uppercase`, `lowercase`, `capitalize`, `normal-case`

Without them a component that writes `uppercase` keeps the class in the
markup while no CSS is emitted — the build succeeds and the text is simply
not transformed.

### `objectRules`

The `object-fit` and `object-position` families, also `presetWind*`‑only:

- `object-cover`, `object-contain`, `object-fill`, `object-scale-down`,
  `object-none` — `object-fit`
- `object-center`, `object-top`, `object-top-left`, … and the short aliases
  (`object-rb` → `right bottom`) — `object-position`, resolved through
  `presetMini`'s own `positionMap`
- `object-[50%_20%]` — bracket values, via `h.bracketOfPosition`

Unlike `presetWind4`, the bracket form does not accept `theme(...)` inside
`[]`: that syntax is a `presetWind4` extension and `presetMini` has no
equivalent.

Declarations match `presetWind*` one for one, so with both loaded the CSS does
not depend on preset order.

### `accessibilityRules`

The screen‑reader pair, also a `presetWind*`‑only family:

- `sr-only` — takes the element out of the visual flow while keeping it in
  the accessibility tree
- `not-sr-only` — undoes it, for the standard
  `class="sr-only focus:not-sr-only"` skip‑link pattern

Declarations match `presetWind*` one for one — with both loaded, UnoCSS
resolves to the last matching rule, so any divergence would make the CSS
depend on preset order.

## API

```ts
import type { Preflight, Rule, Variant } from '@unocss/core'

export const accessibilityRules: Rule[]

export const animationRules: Rule[]
export const animationPreflights: Preflight[]

export const colorOpacityRules: Rule[]

export const filterRules: Rule[]

export const objectRules: Rule[]

export const typographyRules: Rule[]

export const spacingRules: Rule[]
export const spacingVariants: Variant[]
```

## Compatibility

- Node ≥ 22
- UnoCSS: `@unocss/core`, `@unocss/preset-mini`, `@unocss/rule-utils`
  in range `^66.7.5` (`>=66.7.5 <67.0.0`).

## License

See [`LICENSE`](./LICENSE).
