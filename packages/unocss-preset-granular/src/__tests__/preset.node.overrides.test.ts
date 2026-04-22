import { describe, expect, it, vi } from 'vitest'
import { defineGranularComponent, defineGranularProvider } from '../contract'
import { tokenDefinitionsFromCssSync } from '../node-utils/tokenDefinitionsFromCss'
import { getGranularNodeCss } from '../preset.node'

vi.mock('../fs/readCss', async () => {
  const actual = await vi.importActual<any>('../fs/readCss')
  return {
    ...actual,
    readCss: vi.fn(async (path: string) => {
      if (path.includes('data:text/css')) {
        return actual.readCss(path)
      }
      return `/* content of ${path} */`
    }),
  }
})

const providerA = defineGranularProvider({
  id: 'a',
  contractVersion: 1,
  packageBaseUrl: 'file:///a/',
  components: [],
  theme: {
    tokensCssUrl: 'file:///a/tokens.css',
    baseCssUrl: 'file:///a/base.css',
    themes: {
      light: 'file:///a/light.css',
      dark: 'file:///a/dark.css',
    },
  },
})

const providerS = defineGranularProvider({
  id: 's',
  contractVersion: 1,
  packageBaseUrl: 'file:///s/',
  components: [],
  theme: {
    tokenDefinitions: {
      light: {
        selector: ':root',
        tokens: { primary: 'blue' },
      },
    },
  },
})

describe('getGranularNodeCss overrides', () => {
  it('level 1: themeFiles override (full replace)', async () => {
    const css = await getGranularNodeCss({
      providers: [providerA],
      themes: {
        names: ['light'],
        themeFiles: {
          light: 'data:text/css,body{background:red}',
        },
      },
    })

    expect(css).toContain('/* content of /a/tokens.css */')
    expect(css).toContain('/* content of /a/base.css */')
    expect(css).toContain('body{background:red}')
    expect(css).not.toContain('/* content of /a/light.css */')
  })

  it('level 1: themeFiles override per provider', async () => {
    const css = await getGranularNodeCss({
      providers: [providerA],
      themes: {
        names: ['light'],
        themeFiles: {
          light: {
            a: 'data:text/css,.override-a{color:red}',
          },
        },
      },
    })
    expect(css).toContain('.override-a{color:red}')
  })

  it('level 2: tokenDefinitions emission', async () => {
    const css = await getGranularNodeCss({
      providers: [providerS],
      themes: { names: ['light'] },
    })
    expect(css).toContain(':root {\n  --primary: blue;\n}')
  })

  it('level 2: tokenOverrides merging', async () => {
    const css = await getGranularNodeCss({
      providers: [providerS],
      themes: {
        names: ['light'],
        tokenOverrides: {
          light: { primary: 'green', secondary: 'yellow' },
        },
      },
    })
    expect(css).toContain('--primary: green;')
    expect(css).toContain('--secondary: yellow;')
  })

  it('level 2: strictTokens mode', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const css = await getGranularNodeCss({
      providers: [providerS],
      themes: {
        names: ['light'],
        tokenOverrides: {
          light: { 'non-existent': 'value' },
        },
        strictTokens: true,
      },
    })
    expect(css).not.toContain('--non-existent: value;')
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('token "non-existent" not found'))
    spy.mockRestore()
  })

  it('mixed mode: some providers with Definitions, some with Files', async () => {
    const css = await getGranularNodeCss({
      providers: [providerS, providerA],
      themes: { names: ['light'] },
    })
    // Structural first
    expect(css).toContain(':root {\n  --primary: blue;\n}')
    // Then file-based for providerA
    expect(css).toContain('/* content of /a/light.css */')
  })

  it('level 2: compound selector (dark.css style) lands into the "dark" theme', async () => {
    // Реальный CSS из packages/simple-package/src/styles/themes/dark.css
    const darkCss = `
.theme-dark,
.dark,
[data-theme='dark'] {
    --card: #1e293b;
    --card-fg: #f8fafc;
    --brd: #334155;
}
`
    const darkDataUrl = `data:text/css,${encodeURIComponent(darkCss)}`

    // Хелпер парсит compound selector; `as` перезаписывает селектор на каноничный.
    const darkDef = tokenDefinitionsFromCssSync(darkDataUrl, {
      as: '.dark, [data-theme="dark"]',
    })
    expect(darkDef.tokens).toEqual({
      'card': '#1e293b',
      'card-fg': '#f8fafc',
      'brd': '#334155',
    })

    const provider = defineGranularProvider({
      id: 'simple',
      contractVersion: 1,
      packageBaseUrl: 'file:///simple/',
      components: [],
      theme: {
        tokenDefinitions: {
          light: { selector: ':root', tokens: { brd: '#e2e8f0' } },
          dark: darkDef,
        },
      },
    })

    const css = await getGranularNodeCss({
      providers: [provider],
      themes: { names: ['light', 'dark'] },
    })

    // Токены dark попали именно под dark-селектор, а не в :root.
    expect(css).toContain('.dark, [data-theme="dark"] {')
    expect(css).toMatch(/\.dark, \[data-theme="dark"\] \{[^}]*--card: #1e293b;[^}]*\}/)
    expect(css).toMatch(/\.dark, \[data-theme="dark"\] \{[^}]*--card-fg: #f8fafc;[^}]*\}/)
    expect(css).toMatch(/\.dark, \[data-theme="dark"\] \{[^}]*--brd: #334155;[^}]*\}/)

    // Светлая тема — отдельным блоком на :root, и токены dark туда не утекли.
    expect(css).toMatch(/:root \{[^}]*--brd: #e2e8f0;[^}]*\}/)
    expect(css).not.toMatch(/:root \{[^}]*--card: #1e293b[^}]*\}/)
  })

  it('level 2: tokenOverrides поверх compound-selector темы', async () => {
    const darkCss = `
.theme-dark, .dark, [data-theme='dark'] {
    --brd: #334155;
}
`
    const darkDef = tokenDefinitionsFromCssSync(
      `data:text/css,${encodeURIComponent(darkCss)}`,
      { as: '.dark' },
    )

    const provider = defineGranularProvider({
      id: 'simple',
      contractVersion: 1,
      packageBaseUrl: 'file:///simple/',
      components: [],
      theme: { tokenDefinitions: { dark: darkDef } },
    })

    const css = await getGranularNodeCss({
      providers: [provider],
      themes: {
        names: ['dark'],
        tokenOverrides: { dark: { brd: 'red' } },
      },
    })

    expect(css).toMatch(/\.dark \{[^}]*--brd: red;[^}]*\}/)
    expect(css).not.toContain('--brd: #334155;')
  })

  it('priority chain: provider → component → tokenOverrides (highest)', async () => {
    const componentTokenized = defineGranularComponent('file:///s/components/XTokenized/', {
      name: 'XTokenized',
      safelist: [],
      tokenDefinitions: {
        light: {
          tokens: {
            // Переопределяет значение провайдера
            'primary': 'green',
            // Новый токен, провайдер не знает
            'x-tokenized': 'red',
          },
        },
      },
    })

    const providerWithComp = defineGranularProvider({
      id: 's',
      contractVersion: 1,
      packageBaseUrl: 'file:///s/',
      components: [componentTokenized],
      theme: {
        tokenDefinitions: {
          light: {
            selector: ':root',
            // Провайдер определяет 'primary' и 'accent'
            tokens: { primary: 'blue', accent: 'purple' },
          },
        },
      },
    })

    const css = await getGranularNodeCss({
      providers: [providerWithComp],
      themes: {
        names: ['light'],
        // Приложение имеет наивысший приоритет:
        //  - перебивает значение, пришедшее от компонента ('x-tokenized')
        //  - перебивает значение, пришедшее от провайдера ('accent')
        //  - добавляет новый токен ('app-only')
        tokenOverrides: {
          light: {
            'x-tokenized': 'orange',
            'accent': 'pink',
            'app-only': 'cyan',
          },
        },
      },
    })

    // 1. Компонент перебил провайдера: primary = green (не blue).
    expect(css).toMatch(/:root \{[^}]*--primary: green;[^}]*\}/)
    expect(css).not.toMatch(/--primary: blue;/)

    // 2. Приложение перебило компонент: x-tokenized = orange (не red).
    expect(css).toMatch(/--x-tokenized: orange;/)
    expect(css).not.toMatch(/--x-tokenized: red;/)

    // 3. Приложение перебило провайдера: accent = pink (не purple).
    expect(css).toMatch(/--accent: pink;/)
    expect(css).not.toMatch(/--accent: purple;/)

    // 4. Новый токен из приложения присутствует.
    expect(css).toMatch(/--app-only: cyan;/)
  })

  it('priority chain: strictTokens accepts component-provided tokens', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const componentTokenized = defineGranularComponent('file:///s/components/XTokenized/', {
      name: 'XTokenized',
      safelist: [],
      tokenDefinitions: {
        light: { tokens: { 'x-tokenized': 'red' } },
      },
    })

    const providerWithComp = defineGranularProvider({
      id: 's',
      contractVersion: 1,
      packageBaseUrl: 'file:///s/',
      components: [componentTokenized],
      theme: {
        tokenDefinitions: {
          light: { selector: ':root', tokens: { primary: 'blue' } },
        },
      },
    })

    const css = await getGranularNodeCss({
      providers: [providerWithComp],
      themes: {
        names: ['light'],
        strictTokens: true,
        tokenOverrides: {
          // 'x-tokenized' известен — пришёл от компонента, должен пропуститься.
          // 'primary' известен — от провайдера, должен пропуститься.
          // 'unknown' — нигде не определён, должен быть отфильтрован.
          light: { 'x-tokenized': 'orange', 'primary': 'green', 'unknown': 'nope' },
        },
      },
    })

    expect(css).toMatch(/--x-tokenized: orange;/)
    expect(css).toMatch(/--primary: green;/)
    expect(css).not.toMatch(/--unknown:/)
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('token "unknown" not found'))
    spy.mockRestore()
  })

  it('baseFile and tokensFile overrides', async () => {
    const css = await getGranularNodeCss({
      providers: [providerA],
      themes: {
        tokensFile: 'data:text/css,.custom-tokens{}',
        baseFile: 'data:text/css,.custom-base{}',
      },
    })
    expect(css).toContain('.custom-tokens{}')
    expect(css).toContain('.custom-base{}')
    expect(css).not.toContain('/* content of file:///a/tokens.css */')
  })
})
