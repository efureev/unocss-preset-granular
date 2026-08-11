# Changelog

All notable changes to `@feugene/unocss-mini-extra-rules`.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions are `0.x`, so **a minor bump may carry breaking changes**.

Entries before `0.6.0` were not tracked separately from
`@feugene/unocss-preset-granular`'s own changelog — see the release tags
(`unocss-mini-extra-rules-v*`) for what shipped in each version.

## [Unreleased]

## [0.8.0] - 2026-08-12

### Added

- **`numericRules` / `numericPreflights` — the `font-variant-numeric` family.**
  `@unocss/preset-mini` ships none of it; the family lives in `presetWind*`.
  Until now a component writing `tabular-nums` kept the class in the markup
  while no CSS was emitted, so a column of numbers jittered as the values
  changed — a table, a paginator or a character counter reflowed on every
  keystroke. `@feugene/granularity` worked around it with the arbitrary form
  `[font-variant-numeric:tabular-nums]`, repeated in 17 places.

  - figure spacing: `tabular-nums`, `proportional-nums`;
  - figure style: `lining-nums`, `oldstyle-nums`;
  - fractions: `diagonal-fractions`, `stacked-fractions`;
  - independent switches: `ordinal`, `slashed-zero`;
  - reset: `normal-nums`.

  The family is composable: `ordinal` and `tabular-nums` set different aspects
  of the same property and must survive together. No rule writes
  `font-variant-numeric` directly — each sets its own custom property and the
  value is assembled from all five, as `presetWind*` does. **`numericPreflights`
  must be registered alongside the rules**, otherwise the property collapses to
  undefined variables.

  The defaults land on the selectors `presetMini` uses for its own preflight
  (`theme.preflightRoot`, by default `*,::before,::after` and `::backdrop`),
  and the variable names are run
  through the generator's `postprocess` — the hook `presetMini` uses to rename
  `--un-*` for a custom `variablePrefix`. Both details are load-bearing: on
  `:root` alone the inherited custom properties would leak a parent's
  `tabular-nums` into a nested `ordinal`, and under `variablePrefix: 'ds-'` the
  utilities would reference `--ds-numeric-*` while the preflight declared
  `--un-numeric-*` — the property would then be assembled from undefined
  variables and silently not apply.

  One deliberate divergence from `presetWind*` remains: it emits the empty
  defaults through `preflightKeys`, only for the keys whose rules actually
  matched, while `numericPreflights` declares all five unconditionally.

### Fixed

- **`filterRules` now register `@property` under the generator's
  `variablePrefix`.** The registered name lives in the selector
  (`@property --un-blur`), and `presetMini`'s `postprocess` — the hook that
  renames `--un-*` — only rewrites a utility's entries. Under
  `presetMini({ variablePrefix: 'ds-' })` the utilities therefore referenced
  `--ds-blur` while `--un-blur` was the variable being registered. The empty
  fallback in `var(--ds-blur,)` kept the filters working, so nothing failed
  visibly; what was lost was `inherits: false`, and with it the guarantee that
  a child element applying its own filter does not pick up the parent's blur.
  `presetWind4` fixes this with a `postprocess` of its own, which rewrites the
  `@property` selector too — but this package sits on top of `presetMini`, so
  it cannot rely on that being loaded and now resolves the names itself.

## [0.7.0] - 2026-08-10

### Added

- **`objectRules` — the `object-fit` and `object-position` families.**
  `@unocss/preset-mini` ships no `object-*` rule at all; both families live in
  `presetWind*`. Until now a component writing `object-cover` kept the class in
  the markup while no CSS was emitted — the build succeeded, the tests stayed
  green, and the image was simply stretched instead of cropped.

  - `object-fit`: `object-cover`, `object-contain`, `object-fill`,
    `object-scale-down`, `object-none`.
  - `object-position`: every `positionMap` keyword and its short alias
    (`object-center`, `object-top-left`, `object-rb`, …) plus bracket values
    (`object-[50%_20%]`), resolved through `presetMini`'s own `positionMap` /
    `h.bracketOfPosition`.

  Declarations match `presetWind*` one for one, so with both loaded the CSS
  does not depend on preset order. One deliberate divergence from
  `presetWind4`: the bracket form does not accept `theme(...)` inside `[]` —
  that is a `presetWind4` theme-function extension with no `presetMini`
  equivalent, and its `bracketOfPosition` takes no `theme` argument.

## [0.6.0] - 2026-08-09

### Fixed

- **`grayscale-100` / `invert-100` / `sepia-100` (and their `backdrop-*`
  pairs) now emit CSS.** `percentWithDefault()` compared `h.percent()` — which
  returns a unitless fraction (`h.percent('100')` → `'1'`) — as if it were a
  `%`-string, slicing off what it assumed was a trailing `%` character. In
  practice this dropped the exact classes a developer reaches for most often
  (`grayscale-100`, full inversion) with no error: the class stayed in the
  markup, no CSS was emitted, and the clamp meant to reject values above
  `100%` let `grayscale-150` through instead. The comparison now uses the
  fraction directly, matching `@unocss/preset-wind3` (the preset this
  clamp actually mirrors — `@unocss/preset-mini` has no filter rules at all).
