import { symbols, type CSSValueInput, type Rule, type RuleContext } from '@unocss/core'
import type { Theme } from '@unocss/preset-mini'

import { getStringComponents } from '@unocss/rule-utils'
import {
  colorResolver,
  colorableShadows,
  globalKeywords,
  h,
  hasParseableColor,
} from '@unocss/preset-mini/utils'

type FilterTheme = Theme & {
  blur?: Record<string, string>
  dropShadow?: Record<string, string | string[]>
}

function defineProperty(property: string, initialValue?: string | number) {
  const declaration: Record<string | symbol, unknown> = {
    [symbols.shortcutsNoMerge]: true,
    [symbols.noMerge]: true,
    [symbols.noScope]: true,
    [symbols.variants]: (() => [{
      parent: '',
      layer: 'properties',
      selector: () => `@property ${property}`,
    }]) as unknown,
    syntax: '"*"',
    inherits: 'false',
  }

  if (initialValue != null)
    declaration['initial-value'] = String(initialValue)

  return declaration as CSSValueInput
}

const filterBaseKeys = [
  'blur',
  'brightness',
  'contrast',
  'grayscale',
  'hue-rotate',
  'invert',
  'saturate',
  'sepia',
  'drop-shadow',
]

const filterProperties = filterBaseKeys.map(key => defineProperty(`--un-${key}`))
const filterCss = filterBaseKeys.map(key => `var(--un-${key},)`).join(' ')

const backdropBaseKeys = [
  'backdrop-blur',
  'backdrop-brightness',
  'backdrop-contrast',
  'backdrop-grayscale',
  'backdrop-hue-rotate',
  'backdrop-invert',
  'backdrop-opacity',
  'backdrop-saturate',
  'backdrop-sepia',
]

const backdropProperties = backdropBaseKeys.map(key => defineProperty(`--un-${key}`))
const backdropCss = backdropBaseKeys.map(key => `var(--un-${key},)`).join(' ')

function percentWithDefault(input?: string, ctx?: RuleContext<FilterTheme>) {
  const theme = ctx?.theme
  let value = h.bracket.cssvar(input || '', theme)
  if (value != null)
    return value

  value = input ? h.percent(input) : '100%'
  if (value != null && Number.parseFloat(value.slice(0, -1)) <= 100)
    return value

  return undefined
}

function toFilter(
  cssVarName: string,
  resolver: (input: string | undefined, ctx: RuleContext<FilterTheme>) => string | undefined,
) {
  return ([, backdropPrefix, input]: string[], ctx: RuleContext<FilterTheme>): (CSSValueInput | string)[] | undefined => {
    const value = resolver(input, ctx) ?? (input === 'none' ? '0' : '')
    if (value === '')
      return undefined

    if (backdropPrefix) {
      return [
        {
          [`--un-${backdropPrefix}${cssVarName}`]: `${cssVarName}(${value})`,
          '-webkit-backdrop-filter': backdropCss,
          'backdrop-filter': backdropCss,
        },
        ...backdropProperties,
      ]
    }

    return [
      {
        [`--un-${cssVarName}`]: `${cssVarName}(${value})`,
        'filter': filterCss,
      },
      ...filterProperties,
    ]
  }
}

function dropShadowResolver(match: string[], ctx: RuleContext<FilterTheme>) {
  const [, input] = match
  const { theme } = ctx
  let segments: string[] = []

  if (input) {
    segments = getStringComponents(input, '/', 2) ?? []
    if (input.startsWith('/'))
      segments = ['', input.slice(1)]
  }

  let value = theme.dropShadow?.[segments[0] || 'DEFAULT']
  const bracketValue = input ? h.bracket.cssvar(input, theme) : undefined

  if ((value != null || bracketValue != null) && !hasParseableColor(bracketValue, theme, 'colors')) {
    const alpha = segments[1] ? h.bracket.percent.cssvar(segments[1], theme) : undefined

    return [
      {
        '--un-drop-shadow-opacity': alpha,
        '--un-drop-shadow': `drop-shadow(${colorableShadows((value || bracketValue)!, '--un-drop-shadow-color').join(') drop-shadow(')})`,
        'filter': filterCss,
      },
      ...filterProperties,
    ]
  }

  if (hasParseableColor(input, theme, 'colors'))
    return colorResolver('--un-drop-shadow-color', 'drop-shadow')(match as RegExpMatchArray, ctx)

  value = input ? h.bracket.cssvar(input, theme) : undefined
  value = value ?? (input === 'none' ? '' : undefined)
  if (value == null)
    return undefined

  return [
    {
      '--un-drop-shadow': value ? `drop-shadow(${value})` : value,
      'filter': filterCss,
    },
    ...filterProperties,
  ]
}

function resolveBlur(input: string | undefined, theme: FilterTheme) {
  return theme.blur?.[input || 'DEFAULT'] || (input ? h.bracket.cssvar.px(input, theme) : undefined)
}

function resolvePercent(input: string | undefined, theme: FilterTheme) {
  return input ? h.bracket.cssvar.percent(input, theme) : undefined
}

function resolveDegree(input: string | undefined, theme: FilterTheme) {
  return input ? h.bracket.cssvar.degree(input, theme) : undefined
}

export const filterRules: Rule<FilterTheme>[] = [
  [
    /^(?:(backdrop-)|filter-)?blur(?:-(.+))?$/,
    toFilter('blur', (input, { theme }) => resolveBlur(input, theme)),
    { autocomplete: ['(backdrop|filter)-blur-$blur', 'blur-$blur', 'filter-blur'] },
  ],
  [
    /^(?:(backdrop-)|filter-)?brightness-(.+)$/,
    toFilter('brightness', (input, { theme }) => resolvePercent(input, theme)),
    { autocomplete: ['(backdrop|filter)-brightness-', 'brightness-'] },
  ],
  [
    /^(?:(backdrop-)|filter-)?contrast-(.+)$/,
    toFilter('contrast', (input, { theme }) => resolvePercent(input, theme)),
    { autocomplete: ['(backdrop|filter)-contrast-', 'contrast-'] },
  ],
  [
    /^(?:filter-)?drop-shadow(?:-?(.+))?$/,
    dropShadowResolver,
    {
      autocomplete: [
        'filter-drop',
        'filter-drop-shadow',
        'filter-drop-shadow-color',
        'drop-shadow',
        'drop-shadow-color',
        'filter-drop-shadow-$dropShadow',
        'drop-shadow-$dropShadow',
        'filter-drop-shadow-$colors',
        'drop-shadow-$colors',
        'filter-drop-shadow-color-$colors',
        'drop-shadow-color-$colors',
        'filter-drop-shadow-color-(op|opacity)',
        'drop-shadow-color-(op|opacity)',
        'filter-drop-shadow-color-(op|opacity)-',
        'drop-shadow(-color)?-(op|opacity)-',
      ],
    },
  ],
  [/^(?:filter-)?drop-shadow-color-(.+)$/, colorResolver('--un-drop-shadow-color', 'drop-shadow')],
  [/^(?:filter-)?drop-shadow(?:-color)?-op(?:acity)?-?(.+)$/, ([, opacity], { theme }) => ({ '--un-drop-shadow-opacity': opacity ? h.bracket.percent(opacity, theme) : undefined })],
  [
    /^(?:(backdrop-)|filter-)?grayscale(?:-(.+))?$/,
    toFilter('grayscale', percentWithDefault),
    { autocomplete: ['(backdrop|filter)-grayscale', '(backdrop|filter)-grayscale-', 'grayscale-'] },
  ],
  [/^(?:(backdrop-)|filter-)?hue-rotate-(.+)$/, toFilter('hue-rotate', (input, { theme }) => resolveDegree(input, theme))],
  [
    /^(?:(backdrop-)|filter-)?invert(?:-(.+))?$/,
    toFilter('invert', percentWithDefault),
    { autocomplete: ['(backdrop|filter)-invert', '(backdrop|filter)-invert-', 'invert-'] },
  ],
  [
    /^(backdrop-)op(?:acity)?-(.+)$/,
    toFilter('opacity', (input, { theme }) => resolvePercent(input, theme)),
    { autocomplete: ['backdrop-(op|opacity)', 'backdrop-(op|opacity)-'] },
  ],
  [
    /^(?:(backdrop-)|filter-)?saturate-(.+)$/,
    toFilter('saturate', (input, { theme }) => resolvePercent(input, theme)),
    { autocomplete: ['(backdrop|filter)-saturate', '(backdrop|filter)-saturate-', 'saturate-'] },
  ],
  [
    /^(?:(backdrop-)|filter-)?sepia(?:-(.+))?$/,
    toFilter('sepia', percentWithDefault),
    { autocomplete: ['(backdrop|filter)-sepia', '(backdrop|filter)-sepia-', 'sepia-'] },
  ],
  ['filter', { 'filter': filterCss }],
  [
    'backdrop-filter',
    {
      '-webkit-backdrop-filter': backdropCss,
      'backdrop-filter': backdropCss,
    },
  ],
  ['filter-none', { 'filter': 'none' }],
  [
    'backdrop-filter-none',
    {
      '-webkit-backdrop-filter': 'none',
      'backdrop-filter': 'none',
    },
  ],
  ...globalKeywords.map(keyword => [`filter-${keyword}`, { 'filter': keyword }] as Rule),
  ...globalKeywords.map(keyword => [
    `backdrop-filter-${keyword}`,
    {
      '-webkit-backdrop-filter': keyword,
      'backdrop-filter': keyword,
    },
  ] as Rule),
]