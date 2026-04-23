import type { Rule } from '@unocss/core'
import { h } from '@unocss/preset-mini/utils'

const CALC_PLUS_OPERATOR_RE = /(?<=[0-9a-zA-Z%)\x5D])\s*\+\s*(?=[0-9a-zA-Z%(])/g
const CSS_LENGTH_RE = /^-?\d+(?:\.\d+)?(?:px|r?em|%|vh|vw|vmin|vmax|ch|ex|cm|mm|in|pt|pc)$/
const CSS_VAR_RE = /^var\(.+\)$/
const CALC_OPERATOR_LEFT_RE = /[0-9a-zA-Z%)\x5D]/
const CALC_OPERATOR_RIGHT_RE = /[0-9a-zA-Z%(]/
const LETTER_RE = /[a-zA-Z]/
const IDENTIFIER_TOKEN_RE = /[0-9a-zA-Z_]/
const DIGIT_RE = /\d/
const TRAILING_SPACES_RE = /\s*$/
const SPACES_BEFORE_CLOSING_PAREN_RE = /\s+\)/g
const SPACES_AFTER_OPENING_PAREN_RE = /\(\s+/g

function previousNonSpaceIndex(value: string, start: number): number {
  for (let index = start; index >= 0; index--) {
    if (value[index] !== ' ')
      return index
  }

  return -1
}

function nextNonSpaceIndex(value: string, start: number): number {
  for (let index = start; index < value.length; index++) {
    if (value[index] !== ' ')
      return index
  }

  return -1
}

function isBinaryCalcMinusOperator(value: string, operatorIndex: number): boolean {
  const previousIndex = previousNonSpaceIndex(value, operatorIndex - 1)
  const nextIndex = nextNonSpaceIndex(value, operatorIndex + 1)

  if (previousIndex === -1 || nextIndex === -1)
    return false

  const previousChar = value[previousIndex]!
  const nextChar = value[nextIndex]!
  if (!CALC_OPERATOR_LEFT_RE.test(previousChar) || !CALC_OPERATOR_RIGHT_RE.test(nextChar))
    return false

  if (!LETTER_RE.test(previousChar))
    return true

  let tokenStart = previousIndex
  while (tokenStart > 0 && IDENTIFIER_TOKEN_RE.test(value[tokenStart - 1]!))
    tokenStart--

  return DIGIT_RE.test(value.slice(tokenStart, previousIndex + 1))
}

function normalizeCalcMinusOperators(value: string): string {
  let normalized = ''

  for (let index = 0; index < value.length; index++) {
    if (value[index] !== '-' || !isBinaryCalcMinusOperator(value, index)) {
      normalized += value[index]
      continue
    }

    normalized = normalized.replace(TRAILING_SPACES_RE, '')
    normalized += ' - '

    while (value[index + 1] === ' ')
      index++
  }

  return normalized
}

function normalizeCalcOperators(value: string): string {
  if (!value.includes('calc('))
    return value

  return normalizeCalcMinusOperators(
    value
      .replace(CALC_PLUS_OPERATOR_RE, ' + ')
      .replace(SPACES_BEFORE_CLOSING_PAREN_RE, ')')
      .replace(SPACES_AFTER_OPENING_PAREN_RE, '('),
  )
}

const SPACE_AND_DIVIDE_SELECTOR = '>:not([hidden])~:not([hidden])'

function variantSpaceAndDivide(matcher: string) {
  if (matcher.startsWith('_'))
    return

  if (!/^space-[xy]-.+$/.test(matcher))
    return

  return {
    matcher,
    selector: (input: string) => input.includes(SPACE_AND_DIVIDE_SELECTOR)
      ? input
      : `${input}${SPACE_AND_DIVIDE_SELECTOR}`,
  }
}

function resolveSpaceAxis(matcher: string, capturedAxis?: string): 'x' | 'y' | undefined {
  if (capturedAxis === 'x' || capturedAxis === 'y')
    return capturedAxis

  if (matcher.startsWith('space-x-'))
    return 'x'

  if (matcher.startsWith('space-y-'))
    return 'y'

  return undefined
}

function resolveSpaceValue(raw: string, theme: any): string | undefined {
  const fromTheme = theme?.spacing?.[raw]
  if (fromTheme != null)
    return normalizeCalcOperators(fromTheme === '0' ? '0px' : `${fromTheme}`)

  if (raw.startsWith('[') && raw.endsWith(']') && raw.length > 2)
    return normalizeCalcOperators(raw.slice(1, -1))

  const parsed = h.bracket.cssvar.auto.fraction.rem(raw)
  if (parsed != null)
    return normalizeCalcOperators(parsed === '0' ? '0px' : `${parsed}`)

  if (CSS_LENGTH_RE.test(raw))
    return raw

  if (CSS_VAR_RE.test(raw))
    return raw

  return undefined
}

function handlerSpace(match: RegExpMatchArray, ctx: any) {
  const [m, capturedAxis, capturedValue] = match

  const d = resolveSpaceAxis(m, capturedAxis)
  const s = capturedValue ?? (d ? m.slice(`space-${d}-`.length) : undefined)
  if (!d || !s)
    return

  const v = resolveSpaceValue(s, ctx.theme)
  if (!v)
    return

  const startProp = d === 'x' ? 'margin-inline-start' : 'margin-block-start'
  const endProp = d === 'x' ? 'margin-inline-end' : 'margin-block-end'

  return {
    [`--un-space-${d}-reverse`]: '0',
    [startProp]: `calc(${v} * calc(1 - var(--un-space-${d}-reverse)))`,
    [endProp]: `calc(${v} * var(--un-space-${d}-reverse))`,
  }
}

function handlerSpaceReverse(match: RegExpMatchArray, _ctx: any) {
  const [m, capturedAxis] = match

  const d = resolveSpaceAxis(m, capturedAxis)
  if (!d)
    return

  return {
    [`--un-space-${d}-reverse`]: '1',
  }
}

export const spacingVariants = [variantSpaceAndDivide]

export const spacingRules: Rule[] = [
  [/^space-([xy])-(.+)$/, handlerSpace],
  [/^space-([xy])-reverse$/, handlerSpaceReverse],
]