import type { Rule } from '@unocss/core'

function resolveBracketValue(raw: string | undefined): string | undefined {
  if (!raw)
    return undefined

  const m = raw.match(/^\[(.+)\]$/)
  if (!m)
    return undefined

  const inner = m[1]
  if (inner == null)
    return undefined

  if (inner.startsWith('color:'))
    return inner.slice('color:'.length)

  return inner
}

function resolveOpacityPercent(raw: string | undefined): number | undefined {
  if (!raw || !/^-?\d+(?:\.\d+)?$/.test(raw))
    return undefined

  const n = Number(raw)
  if (!Number.isFinite(n))
    return undefined

  return Math.max(0, Math.min(100, n))
}

function colorMixSrgbTransparent(color: string, opacityPercent: number): string {
  return `color-mix(in srgb, ${color} ${opacityPercent}%, transparent)`
}

export const colorOpacityRules: Rule[] = [
  [
    /^bg-(\[[^\]]+\])\/(\d+(?:\.\d+)?)$/,
    ([, rawColor, rawOpacity]) => {
      const color = resolveBracketValue(rawColor)
      const opacity = resolveOpacityPercent(rawOpacity)
      if (!color || opacity == null)
        return undefined

      return {
        'background-color': colorMixSrgbTransparent(color, opacity),
      }
    },
  ],
  [
    /^border-(\[[^\]]+\])\/(\d+(?:\.\d+)?)$/,
    ([, rawColor, rawOpacity]) => {
      const color = resolveBracketValue(rawColor)
      const opacity = resolveOpacityPercent(rawOpacity)
      if (!color || opacity == null)
        return undefined

      return {
        'border-color': colorMixSrgbTransparent(color, opacity),
      }
    },
  ],
]