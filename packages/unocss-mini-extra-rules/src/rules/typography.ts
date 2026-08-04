import type { Rule } from '@unocss/core'

/**
 * `text-transform` utilities.
 *
 * `presetMini` ships `italic` and `underline` but omits the whole
 * `text-transform` family — it lives in `presetWind*`. A component that writes
 * `uppercase` therefore keeps the class in the markup while no CSS is emitted:
 * the build succeeds, tests stay green, and the text is simply not
 * transformed. Only a real page reveals it.
 */
export const typographyRules: Rule[] = [
  ['uppercase', { 'text-transform': 'uppercase' }],
  ['lowercase', { 'text-transform': 'lowercase' }],
  ['capitalize', { 'text-transform': 'capitalize' }],
  // Tailwind's `normal-case` resets the property rather than setting a
  // `normal` keyword — `text-transform` has no such value.
  ['normal-case', { 'text-transform': 'none' }],
]
