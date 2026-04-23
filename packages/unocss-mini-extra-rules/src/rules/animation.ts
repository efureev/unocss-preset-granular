import type { Preflight, Rule } from '@unocss/core'

export const animationRules: Rule[] = [
  [
    /^animate-spin$/,
    () => ({
      animation: 'granularity-spin 1s linear infinite',
    }),
  ],
]

export const animationPreflights: Preflight[] = [
  {
    getCSS: () => '@keyframes granularity-spin{to{transform:rotate(360deg)}}',
  },
]
