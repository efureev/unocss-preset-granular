import { describe, expect, it } from 'vitest'
import { defineGranularProvider } from '../contract'
import {
  getGranularComponentCss,
  getGranularComponentCssFiles,
  getGranularNodeCss,
  getGranularThemeCss,
} from '../preset.node'

const cssA = 'data:text/css,.a{color:red}'
const cssB = 'data:text/css,.b{color:blue}'
const shared = 'data:text/css,.shared{color:green}'

/** Провайдер с base/tokens/структурными токенами и component CSS (всё через data-URL). */
const provider = defineGranularProvider({
  id: 'h',
  contractVersion: 1,
  packageBaseUrl: 'file:///h/',
  components: [
    { name: 'A', safelist: [], cssFiles: [cssA] },
    { name: 'B', safelist: [], cssFiles: [cssB] },
  ],
  theme: {
    tokensCssUrl: 'data:text/css,.tokens{}',
    baseCssUrl: 'data:text/css,.base{}',
    tokenDefinitions: {
      light: { selector: ':root', tokens: { primary: 'blue' } },
    },
  },
})

const opts = { providers: [provider], components: 'all' as const, themes: { names: ['light'] } }

describe('node CSS helpers (G3)', () => {
  it('getGranularComponentCss: только component CSS, без base/tokens/тем', async () => {
    const css = await getGranularComponentCss(opts)
    expect(css).toContain('.a{color:red}')
    expect(css).toContain('.b{color:blue}')
    expect(css).not.toContain('.base{}')
    expect(css).not.toContain('.tokens{}')
    expect(css).not.toContain('--primary')
  })

  it('getGranularThemeCss: только base/tokens/тема, без component CSS', async () => {
    const css = await getGranularThemeCss(opts)
    expect(css).toContain('.base{}')
    expect(css).toContain('.tokens{}')
    expect(css).toContain(':root {\n  --primary: blue;\n}')
    expect(css).not.toContain('.a{color:red}')
    expect(css).not.toContain('.b{color:blue}')
  })

  it('тема + компоненты = полный node CSS (комплементарность)', async () => {
    const themeCss = await getGranularThemeCss(opts)
    const componentCss = await getGranularComponentCss(opts)
    const nodeCss = await getGranularNodeCss(opts)
    expect(nodeCss).toBe([themeCss, componentCss].filter(Boolean).join('\n'))
  })

  it('getGranularComponentCssFiles: список URL всех component CSS', async () => {
    const files = await getGranularComponentCssFiles(opts)
    expect(files).toEqual([cssA, cssB])
  })

  it('getGranularComponentCssFiles: дедуп одного и того же файла у двух компонентов', async () => {
    const dupProvider = defineGranularProvider({
      id: 'dup',
      contractVersion: 1,
      packageBaseUrl: 'file:///dup/',
      components: [
        { name: 'A', safelist: [], cssFiles: [shared] },
        { name: 'B', safelist: [], cssFiles: [shared] },
      ],
    })
    const files = await getGranularComponentCssFiles({ providers: [dupProvider], components: 'all' })
    expect(files).toEqual([shared])
  })

  it('getGranularComponentCss пуст, если у выбранных компонентов нет cssFiles', async () => {
    const bare = defineGranularProvider({
      id: 'bare',
      contractVersion: 1,
      packageBaseUrl: 'file:///bare/',
      components: [{ name: 'X', safelist: [] }],
    })
    const css = await getGranularComponentCss({ providers: [bare], components: 'all' })
    expect(css).toBe('')
    const files = await getGranularComponentCssFiles({ providers: [bare], components: 'all' })
    expect(files).toEqual([])
  })
})
