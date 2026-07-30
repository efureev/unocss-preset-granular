import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { defineGranularComponent, defineGranularProvider } from '../contract'
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

describe('мемоизация путей к CSS компонентов (AUDIT D3)', () => {
  it('второй вызов не переспрашивает FS — путь остаётся прежним', async () => {
    const root = mkdtempSync(join(tmpdir(), 'granular-cssfiles-'))
    try {
      const srcDir = join(root, 'src/components/X')
      const distDir = join(root, 'dist/components/X')
      mkdirSync(srcDir, { recursive: true })
      mkdirSync(distDir, { recursive: true })
      writeFileSync(join(srcDir, 'styles.css'), '.from-src{}', 'utf8')
      writeFileSync(join(distDir, 'styles.css'), '.from-dist{}', 'utf8')

      // `cssFiles` указывает в src, `cssFileAssetNames` (их проставляет
      // defineGranularComponent) — в `components/X/styles.css` от packageBaseUrl.
      const descriptor = defineGranularComponent(
        pathToFileURL(join(srcDir, 'config.ts')).href,
        { name: 'X', cssFiles: ['./styles.css'] },
      )
      const withCss = defineGranularProvider({
        id: 'memo',
        contractVersion: 1,
        packageBaseUrl: pathToFileURL(`${join(root, 'dist')}/`).href,
        components: [descriptor],
      })
      const memoOpts = { providers: [withCss], components: 'all' as const }

      const [first] = await getGranularComponentCssFiles(memoOpts)
      expect(first.endsWith(join('src', 'components', 'X', 'styles.css'))).toBe(true)

      // Исходник исчез. Без кэша резолвер ушёл бы на fallback в dist —
      // значит совпадение путей и есть доказательство мемоизации.
      rmSync(join(srcDir, 'styles.css'))
      const [second] = await getGranularComponentCssFiles(memoOpts)
      expect(second).toBe(first)

      // Новый объект опций считает заново и видит уже только dist.
      const [fresh] = await getGranularComponentCssFiles({ ...memoOpts })
      expect(fresh.endsWith(join('dist', 'components', 'X', 'styles.css'))).toBe(true)
    }
    finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('параллельное чтение файлов тем (AUDIT D2)', () => {
  it('порядок тем в CSS соответствует порядку `names`', async () => {
    const themed = defineGranularProvider({
      id: 't',
      contractVersion: 1,
      packageBaseUrl: 'file:///t/',
      components: [],
      theme: {
        themes: {
          light: 'data:text/css,.theme-light{}',
          dark: 'data:text/css,.theme-dark{}',
        },
      },
    })

    const css = await getGranularThemeCss({ providers: [themed], themes: { names: ['light', 'dark'] } })
    expect(css.indexOf('.theme-light')).toBeLessThan(css.indexOf('.theme-dark'))

    const reversed = await getGranularThemeCss({ providers: [themed], themes: { names: ['dark', 'light'] } })
    expect(reversed.indexOf('.theme-dark')).toBeLessThan(reversed.indexOf('.theme-light'))
  })
})
