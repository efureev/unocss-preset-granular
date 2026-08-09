# Changelog

All notable changes to `@feugene/unocss-mini-extra-rules`.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions are `0.x`, so **a minor bump may carry breaking changes**.

Entries before `0.6.0` were not tracked separately from
`@feugene/unocss-preset-granular`'s own changelog — see the release tags
(`unocss-mini-extra-rules-v*`) for what shipped in each version.

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
