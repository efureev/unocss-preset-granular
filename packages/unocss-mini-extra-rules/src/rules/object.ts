import type { Rule } from '@unocss/core'

import { h, positionMap } from '@unocss/preset-mini/utils'

/**
 * The `object-fit` and `object-position` families, absent from `presetMini` —
 * they live in `presetWind*` (`objectPositions` there).
 *
 * The failure mode is the same silent one as with `text-transform`: a
 * component writes `object-cover`, the class stays in the markup, no CSS is
 * emitted, and the image is simply stretched instead of cropped. The build
 * succeeds and the tests stay green; only a real page shows it.
 *
 * Declarations match `presetWind*` one for one — with both loaded, UnoCSS
 * resolves to the last matching rule, so any divergence would make the CSS
 * depend on preset order.
 */
export const objectRules: Rule[] = [
  ['object-cover', { 'object-fit': 'cover' }],
  ['object-contain', { 'object-fit': 'contain' }],
  ['object-fill', { 'object-fit': 'fill' }],
  ['object-scale-down', { 'object-fit': 'scale-down' }],
  ['object-none', { 'object-fit': 'none' }],
  // Greedy, and deliberately placed after the `object-fit` values it would
  // otherwise swallow. It cannot: UnoCSS indexes string rules in a separate
  // static map that `parseUtil` consults BEFORE walking the dynamic rules, so
  // `object-cover` never reaches this handler regardless of array order.
  // (`positionMap` has no `cover`/`contain`/`fill`/`none`/`scale-down` key
  // either, so even a direct hit would fall through — but the static map is
  // what actually guarantees it.)
  [
    /^object-(.+)$/,
    ([, d]) => {
      if (!d)
        return undefined
      const keyword = positionMap[d]
      if (keyword)
        return { 'object-position': keyword }
      // `presetMini`'s `bracketOfPosition` takes no `theme`: the extra argument
      // `presetWind4` passes drives its own `theme(...)`-in-bracket syntax,
      // which `presetMini` does not have.
      const position = h.bracketOfPosition(d)
      if (position != null) {
        return {
          'object-position': position
            .split(' ')
            .map(part => h.position.fraction.auto.px.cssvar(part) ?? part)
            .join(' '),
        }
      }
    },
    { autocomplete: `object-(${Object.keys(positionMap).join('|')})` },
  ],
]
