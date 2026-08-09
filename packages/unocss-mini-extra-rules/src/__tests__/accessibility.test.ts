import { createGenerator } from '@unocss/core'
import { describe, expect, it } from 'vitest'

import { accessibilityRules } from '../index'

async function generate(className: string) {
  const uno = await createGenerator({ rules: accessibilityRules })
  const { css } = await uno.generate(className)
  return css
}

describe('accessibilityRules', () => {
  it('sr-only визуально прячет элемент, оставляя его доступным скринридеру', async () => {
    const css = await generate('sr-only')
    expect(css).toContain('clip:rect(0,0,0,0)')
    expect(css).toContain('position:absolute')
  })

  it('not-sr-only возвращает элемент в поток, не трогая border-width', async () => {
    const css = await generate('not-sr-only')
    expect(css).toContain('position:static')
    expect(css).not.toContain('border-width')
  })
})
