import { createGenerator } from '@unocss/core'
import { describe, expect, it } from 'vitest'

import { typographyRules } from '../index'

async function generate(className: string) {
  const uno = await createGenerator({ rules: typographyRules })
  const { css } = await uno.generate(className)
  return css
}

describe('typographyRules', () => {
  it.each([
    ['uppercase', 'text-transform:uppercase'],
    ['lowercase', 'text-transform:lowercase'],
    ['capitalize', 'text-transform:capitalize'],
    ['normal-case', 'text-transform:none'],
  ])('%s → %s', async (className, expected) => {
    expect(await generate(className)).toContain(expected)
  })
})
