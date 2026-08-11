import type { Rule, RuleContext } from '@unocss/core'

import { theme } from '@unocss/preset-mini'
import { describe, expect, it } from 'vitest'

import { spacingRules, spacingVariants } from '../index'

// Invokes rule handlers directly (no extractor/tokenizer involved), so class
// names containing raw spaces — the exact shape `calc()` normalization is
// meant to survive — can be passed as-is. Mirrors `UnoGenerator.parseUtil`
// (`@unocss/core`): dynamic rules are tried in REVERSE declaration order and
// the first one whose handler returns a truthy result wins — a later rule
// that matches syntactically but resolves to nothing (e.g. the greedy
// `space-x-(.+)` regex also matching `space-x-reverse`, whose handler then
// rejects `'reverse'` as a length) is skipped, not treated as a hit.
function run(rules: Rule[], className: string) {
  const ctx = {
    theme,
    generator: { config: { envMode: 'build' } },
  } as unknown as RuleContext

  for (const [matcher, handler] of [...rules].reverse()) {
    const match = typeof matcher === 'string'
      ? (matcher === className ? [className] : null)
      : className.match(matcher)
    if (!match)
      continue
    const result = typeof handler === 'function' ? handler(match as RegExpMatchArray, ctx) : handler
    if (result)
      return result as Record<string, string>
  }
  return undefined
}

// `normalizeCalcOperators` — ручной парсер бинарного минуса/плюса внутри
// `calc()`. Батарея значений — из раздела «Подтверждено» аудита.
describe('spacing: calc()-нормализатор', () => {
  it.each([
    ['space-x-[calc(100%-1rem)]', 'calc(100% - 1rem)'],
    ['space-x-[calc(1rem+2px)]', 'calc(1rem + 2px)'],
    ['space-x-[calc(-1rem)]', 'calc(-1rem)'],
    ['space-x-[calc(1rem - -2px)]', 'calc(1rem - -2px)'],
    ['space-x-[calc(1rem-2px)]', 'calc(1rem - 2px)'],
    ['space-x-[calc(1rem -   2px)]', 'calc(1rem - 2px)'],
  ])('%s → %s', (className, expected) => {
    const css = run(spacingRules, className)
    expect(css?.['margin-inline-start']).toContain(expected)
  })
})

describe('spacing: resolveSpaceValue — источники значения помимо bracket', () => {
  it('space-x-none берёт значение из theme.spacing (нулевой размер нормализуется в 0px)', () => {
    const css = run(spacingRules, 'space-x-none')
    expect(css?.['margin-inline-start']).toContain('0px')
  })

  it('space-x-10px принимает голую CSS-длину без скобок', () => {
    const css = run(spacingRules, 'space-x-10px')
    expect(css?.['margin-inline-start']).toContain('10px')
  })

  it('space-x-var(--gap) принимает голый var() без скобок', () => {
    const css = run(spacingRules, 'space-x-var(--gap)')
    expect(css?.['margin-inline-start']).toContain('var(--gap)')
  })
})

// Приоритет `divide-*` width vs color: негативный lookahead в regex цвета
// должен пропускать осевые формы (`divide-y-2`) к width-хендлеру, а не
// перебивать его — UnoCSS резолвит в ПОСЛЕДНЕЕ совпавшее правило.
describe('spacing: приоритет divide-* width vs color', () => {
  it('divide-y-2 задаёт ширину бордера, не цвет', () => {
    const css = run(spacingRules, 'divide-y-2')
    expect(css).toHaveProperty('border-top-width')
    expect(css).toHaveProperty('border-bottom-width')
    expect(css).not.toHaveProperty('border-color')
  })

  it('divide-yellow задаёт цвет бордера, не ширину', () => {
    const css = run(spacingRules, 'divide-yellow')
    expect(css).toHaveProperty('border-color')
    expect(css).not.toHaveProperty('border-top-width')
  })

  it('divide-slate-300 задаёт цвет бордера', () => {
    const css = run(spacingRules, 'divide-slate-300')
    expect(css).toHaveProperty('border-color')
  })

  it('divide-[var(--brd)] задаёт цвет бордера через bracket-значение', () => {
    const css = run(spacingRules, 'divide-[var(--brd)]')
    expect(css?.['border-color']).toContain('var(--brd)')
  })
})

describe('spacing: space-y и *-reverse', () => {
  it('space-y-4 задаёт margin-block', () => {
    const css = run(spacingRules, 'space-y-4')
    expect(css).toHaveProperty('margin-block-start')
    expect(css).toHaveProperty('margin-block-end')
  })

  it('space-x-reverse и space-y-reverse переключают --un-space-*-reverse', () => {
    expect(run(spacingRules, 'space-x-reverse')).toEqual({ '--un-space-x-reverse': '1' })
    expect(run(spacingRules, 'space-y-reverse')).toEqual({ '--un-space-y-reverse': '1' })
  })

  it('divide-x-reverse и divide-y-reverse переключают --un-divide-*-reverse', () => {
    expect(run(spacingRules, 'divide-x-reverse')).toEqual({ '--un-divide-x-reverse': '1' })
    expect(run(spacingRules, 'divide-y-reverse')).toEqual({ '--un-divide-y-reverse': '1' })
  })
})

describe('spacing: resolveDivideWidth', () => {
  it('divide-x без значения даёт ширину по умолчанию 1px', () => {
    const css = run(spacingRules, 'divide-x')
    expect(css?.['border-left-width']).toContain('1px')
  })

  it('divide-x-4 (число без единиц) трактуется как px', () => {
    const css = run(spacingRules, 'divide-x-4')
    expect(css?.['border-left-width']).toContain('4px')
  })

  it('divide-x-[2rem] берёт значение из bracket', () => {
    const css = run(spacingRules, 'divide-x-[2rem]')
    expect(css?.['border-left-width']).toContain('2rem')
  })

  it('divide-x-2rem принимает голую CSS-длину без скобок', () => {
    const css = run(spacingRules, 'divide-x-2rem')
    expect(css?.['border-left-width']).toContain('2rem')
  })

  it('divide-x-var(--w) принимает голый var() без скобок', () => {
    const css = run(spacingRules, 'divide-x-var(--w)')
    expect(css?.['border-left-width']).toContain('var(--w)')
  })

  it('divide-y-thick (нераспознаваемое значение) не матчит ширину', () => {
    expect(run(spacingRules, 'divide-y-thick')).toBeUndefined()
  })
})

describe('spacing: variantSpaceAndDivide', () => {
  const variant = spacingVariants[0]!

  it('добавляет sibling-селектор к space-x/space-y и divide-*', () => {
    expect(variant('space-x-4')?.selector?.('.space-x-4')).toBe('.space-x-4>:not([hidden])~:not([hidden])')
    expect(variant('divide-y-2')?.selector?.('.divide-y-2')).toBe('.divide-y-2>:not([hidden])~:not([hidden])')
  })

  it('не дублирует селектор, если он уже применён', () => {
    const already = '.space-x-4>:not([hidden])~:not([hidden])'
    expect(variant('space-x-4')?.selector?.(already)).toBe(already)
  })

  it('не применяется к вариантам с подчёркиванием (_) и к посторонним классам', () => {
    expect(variant('_space-x-4')).toBeUndefined()
    expect(variant('p-4')).toBeUndefined()
  })
})

// Границы ручного парсера бинарного минуса: он обязан отличать оператор от
// знака числа и не спотыкаться о минус в начале и в конце значения. Обе
// ситуации достижимы из bracket-формы, и обе раньше не проверялись.
describe('spacing: минус на краях значения', () => {
  it('space-x-[-1rem] — ведущий минус остаётся знаком числа, а не оператором', () => {
    const css = run(spacingRules, 'space-x-[-1rem]')
    expect(css?.['margin-inline-start']).toContain('calc(-1rem *')
    expect(css?.['margin-inline-start']).not.toContain('- 1rem')
  })

  it('space-x-[calc(1px-)] — висящий минус не превращается в оператор', () => {
    const css = run(spacingRules, 'space-x-[calc(1px-)]')
    expect(css?.['margin-inline-start']).toContain('calc(1px-)')
  })
})

describe('spacing: остальные источники значения space-*', () => {
  it('space-x-0 берёт ноль из theme.spacing и нормализует его в 0px', () => {
    const css = run(spacingRules, 'space-x-0')
    expect(css?.['margin-inline-start']).toContain('calc(0px *')
  })

  it('space-x-1/2 разбирает дробь в проценты', () => {
    const css = run(spacingRules, 'space-x-1/2')
    expect(css?.['margin-inline-start']).toContain('calc(50% *')
  })

  it('space-x-10vh принимает вьюпортные единицы', () => {
    const css = run(spacingRules, 'space-x-10vh')
    expect(css?.['margin-inline-start']).toContain('calc(10vh *')
  })
})

describe('spacing: divide-x-0', () => {
  // Ноль как ширина: голое число трактуется как px, и `0` не должен потеряться
  // на проверке truthy — `divide-x-0` это осмысленный «убрать разделитель».
  it('divide-x-0 даёт нулевую ширину, а не отсутствие правила', () => {
    const css = run(spacingRules, 'divide-x-0')
    expect(css?.['border-left-width']).toContain('calc(0px *')
  })
})
