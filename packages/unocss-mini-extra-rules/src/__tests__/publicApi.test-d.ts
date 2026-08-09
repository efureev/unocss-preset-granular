import type { Preflight, Rule, Variant } from '@unocss/core'

import { expectTypeOf } from 'vitest'

import {
  accessibilityRules,
  animationPreflights,
  animationRules,
  colorOpacityRules,
  filterRules,
  spacingRules,
  spacingVariants,
  typographyRules,
} from '../index'

// Type-level freeze of the public API from `src/index.ts`. UnoCSS consumers
// (the granular preset, apps) spread these arrays straight into their own
// `rules`/`variants`/`preflights`, so a shape regression here (a dropped
// export, a `Theme` generic that widens to `unknown`) surfaces to them as a
// type error at the call site, not as a red test in this package. This file
// is what turns it into one — checked by `vitest --typecheck`, not executed
// at runtime.
expectTypeOf(accessibilityRules).toExtend<Rule[]>()
expectTypeOf(animationRules).toExtend<Rule[]>()
expectTypeOf(animationPreflights).toExtend<Preflight[]>()
expectTypeOf(colorOpacityRules).toExtend<Rule[]>()
expectTypeOf(filterRules).toExtend<Rule<any>[]>()
expectTypeOf(spacingRules).toExtend<Rule[]>()
expectTypeOf(spacingVariants).toExtend<Variant<any>[]>()
expectTypeOf(typographyRules).toExtend<Rule[]>()
