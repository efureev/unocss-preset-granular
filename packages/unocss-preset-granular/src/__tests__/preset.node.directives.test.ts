import { createGenerator } from '@unocss/core'
import presetMini from '@unocss/preset-mini'
import { describe, expect, it } from 'vitest'
import { defineGranularProvider } from '../contract'
import { getGranularNodeCss, presetGranularNode } from '../preset.node'

/** Провайдер с компонентом, чей CSS содержит `@apply`. */
const provider = defineGranularProvider({
  id: 'd',
  contractVersion: 1,
  packageBaseUrl: 'file:///d/',
  components: [
    {
      name: 'C',
      safelist: [],
      cssFiles: [`data:text/css,${encodeURIComponent('.x{ @apply p-4; }')}`],
    },
  ],
})

async function getNodePreflightCss(options: Parameters<typeof presetGranularNode>[0]): Promise<string> {
  const uno = await createGenerator({ presets: [presetMini()] })
  const preset = presetGranularNode(options)
  const preflight = preset.preflights![0]
  const css = await preflight.getCSS({ generator: uno, theme: (uno as any).config?.theme ?? {} } as never)
  return css ?? ''
}

describe('expandDirectives (G2)', () => {
  it('раскрывает @apply в component cssFiles при expandDirectives=true', async () => {
    const css = await getNodePreflightCss({
      providers: [provider],
      components: 'all',
      expandDirectives: true,
    })
    expect(css).toContain('padding')
    expect(css).not.toContain('@apply')
  })

  it('по умолчанию @apply остаётся нераскрытым', async () => {
    const css = await getNodePreflightCss({
      providers: [provider],
      components: 'all',
    })
    expect(css).toContain('@apply p-4')
    expect(css).not.toContain('padding')
  })

  it('getGranularNodeCss отдаёт сырой CSS (без раскрытия директив)', async () => {
    const raw = await getGranularNodeCss({
      providers: [provider],
      components: 'all',
      expandDirectives: true,
    })
    expect(raw).toContain('@apply p-4')
  })
})
