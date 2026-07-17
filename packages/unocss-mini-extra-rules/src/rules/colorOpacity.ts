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
  // The rule regexes only ever capture `\d+(\.\d+)?`, so a negative sign can
  // never reach here — keep the pattern in sync (no `-?`). Values above 100
  // are clamped to 100 (a `color-mix` percentage can't exceed 100%).
  if (!raw || !/^\d+(?:\.\d+)?$/.test(raw))
    return undefined

  const n = Number(raw)
  if (!Number.isFinite(n))
    return undefined

  return Math.min(100, n)
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