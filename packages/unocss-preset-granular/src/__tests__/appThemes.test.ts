import type { GranularProvider } from '../contract'
import type { PresetGranularOptions } from '../preset'

import { describe, expect, it } from 'vitest'
import { defineGranularProvider } from '../contract'
import { defaultAppThemeSelector, resolveThemes } from '../core/resolveThemes'
import { materializeGranularOptions } from '../node-utils/materializeRefs'
import { getGranularThemeManifest } from '../node-utils/themeManifest'
import { getGranularThemeCss } from '../preset.node'
import { createThemeController } from '../runtime'

/**
 * Провайдер со СТРУКТУРНЫМИ токенами: только такие темы можно наследовать —
 * значения известны пресету, а не спрятаны внутри CSS-файла.
 */
const structural: GranularProvider = defineGranularProvider({
  id: 'ds',
  contractVersion: 1,
  packageBaseUrl: 'file:///ds/',
  components: [],
  theme: {
    defaultThemes: ['light', 'dark'],
    tokenDefinitions: {
      light: { selector: ':root', tokens: { bg: '#fff', fg: '#000', radius: '4px' } },
      dark: { selector: '.dark', tokens: { bg: '#000', fg: '#fff' } },
    },
  },
})

/** Провайдер, отдающий тему готовым файлом — для пресета она непрозрачна. */
const opaque: GranularProvider = defineGranularProvider({
  id: 'op',
  contractVersion: 1,
  packageBaseUrl: 'file:///op/',
  components: [],
  theme: { themes: { legacy: 'file:///op/legacy.css' } },
})

describe('themes.define — набор тем принадлежит приложению', () => {
  it('без names набор тем равен ключам define, а не defaultThemes провайдеров', () => {
    const r = resolveThemes([structural], {
      define: {
        emerald: { extends: 'light', tokens: { bg: '#052e1f' } },
        crimson: { extends: 'light', tokens: { bg: '#450a0a' } },
      },
    })

    expect(r.names).toEqual(['emerald', 'crimson'])
    expect(r.namesSource).toBe('app-defined')
    // Тем провайдера в сборке нет вовсе — именно этого и добивается приложение.
    expect(Object.keys(r.tokenRegistry)).toEqual(['emerald', 'crimson'])
  })

  it('единственная тема под :root — переключатель не нужен', () => {
    const r = resolveThemes([structural], {
      define: { brand: { extends: 'dark', selector: ':root', tokens: { fg: '#eee' } } },
    })

    expect(r.names).toEqual(['brand'])
    expect(r.tokenRegistry.brand.blocks).toEqual([
      { selector: ':root', tokens: { bg: '#000', fg: '#eee' } },
    ])
  })

  it('явный names перебивает define: тему можно объявить, но не активировать', () => {
    const r = resolveThemes([structural], {
      names: ['light'],
      define: { emerald: { extends: 'light' } },
    })

    expect(r.names).toEqual(['light'])
    expect(r.namesSource).toBe('explicit')
    expect(r.tokenRegistry.emerald).toBeUndefined()
  })
})

describe('themes.define — extends', () => {
  it('база резолвится, но в сборку не попадает', () => {
    const r = resolveThemes([structural], {
      names: ['emerald'],
      define: { emerald: { extends: 'light', tokens: { bg: '#052e1f' } } },
    })

    expect(r.names).toEqual(['emerald'])
    expect(r.tokenRegistry.light).toBeUndefined()
    // radius унаследован от light, bg перекрыт приложением.
    expect(r.tokenRegistry.emerald.tokens).toEqual({
      bg: '#052e1f',
      fg: '#000',
      radius: '4px',
    })
  })

  it('унаследованные токены переезжают под селектор новой темы', () => {
    // База dark висит на `.dark`; если бы токены остались там, тема ocean
    // включалась бы вместе с dark — и не включалась бы сама по себе.
    const r = resolveThemes([structural], {
      names: ['ocean'],
      define: { ocean: { extends: 'dark', tokens: { bg: '#082f49' } } },
    })

    expect(r.tokenRegistry.ocean.blocks).toEqual([{
      selector: defaultAppThemeSelector('ocean'),
      tokens: { bg: '#082f49', fg: '#fff' },
    }])
  })

  it('цепочка extends: базы применяются раньше наследников', () => {
    const r = resolveThemes([structural], {
      names: ['ocean-hc'],
      define: {
        'ocean': { extends: 'light', tokens: { bg: '#082f49' } },
        'ocean-hc': { extends: 'ocean', tokens: { fg: '#ffffff' } },
      },
    })

    expect(r.names).toEqual(['ocean-hc'])
    expect(r.tokenRegistry['ocean-hc'].tokens).toEqual({
      bg: '#082f49',
      fg: '#ffffff',
      radius: '4px',
    })
  })

  it('вклад приложения ложится ПОВЕРХ провайдера для темы с тем же именем', () => {
    const r = resolveThemes([structural], {
      names: ['dark'],
      define: { dark: { tokens: { bg: '#111' } } },
    })

    // Селектор провайдера сохранён: определение без extends/selector — это
    // точечный мерж, а не переобъявление темы.
    expect(r.tokenRegistry.dark.blocks).toEqual([
      { selector: '.dark', tokens: { bg: '#111', fg: '#fff' } },
    ])
  })
})

describe('themes.define — диагностика', () => {
  it('extends на неизвестную тему — warning, а не молча пустая палитра', () => {
    const r = resolveThemes([structural], {
      names: ['emerald'],
      define: { emerald: { extends: 'lite', tokens: { bg: '#052e1f' } } },
    })

    expect(r.warnings).toContainEqual({
      kind: 'theme-extends-unresolved',
      theme: 'emerald',
      base: 'lite',
      reason: 'unknown',
    })
  })

  it('extends на тему-файл — reason: opaque', () => {
    const r = resolveThemes([opaque], {
      names: ['emerald'],
      define: { emerald: { extends: 'legacy' } },
    })

    expect(r.warnings).toContainEqual({
      kind: 'theme-extends-unresolved',
      theme: 'emerald',
      base: 'legacy',
      reason: 'opaque',
    })
  })

  it('цикл в extends обрывается с warning, резолв не виснет', () => {
    const r = resolveThemes([structural], {
      names: ['a'],
      define: {
        a: { extends: 'b', tokens: { fg: '#1' } },
        b: { extends: 'a', tokens: { bg: '#2' } },
      },
    })

    expect(r.warnings.some(w => w.kind === 'theme-extends-cycle')).toBe(true)
    expect(r.names).toEqual(['a'])
  })

  it('partial-theme не срабатывает на темы, которые поставляет само приложение', () => {
    const other: GranularProvider = defineGranularProvider({
      id: 'other',
      contractVersion: 1,
      packageBaseUrl: 'file:///other/',
      components: [],
      theme: { tokenDefinitions: { light: { tokens: { accent: 'red' } } } },
    })

    const r = resolveThemes([structural, other], {
      names: ['emerald'],
      define: { emerald: { extends: 'light', tokens: { bg: '#052e1f' } } },
    })

    expect(r.warnings.filter(w => w.kind === 'partial-theme')).toEqual([])
  })
})

describe('themes.define — метаданные и манифест', () => {
  const options = {
    providers: [structural],
    themes: {
      define: {
        emerald: { extends: 'light', tokens: { bg: '#052e1f' }, label: 'Изумруд', colorScheme: 'dark' as const },
        sand: { extends: 'light', tokens: { bg: '#fef3c7' }, label: 'Песок', colorScheme: 'light' as const },
      },
    },
  }

  it('label и colorScheme доезжают до манифеста', () => {
    const manifest = getGranularThemeManifest(options)

    expect(manifest.themes).toEqual([
      {
        name: 'emerald',
        selectors: [defaultAppThemeSelector('emerald')],
        activation: { type: 'attribute', name: 'data-theme', value: 'emerald' },
        label: 'Изумруд',
        colorScheme: 'dark',
      },
      {
        name: 'sand',
        selectors: [defaultAppThemeSelector('sand')],
        activation: { type: 'attribute', name: 'data-theme', value: 'sand' },
        label: 'Песок',
        colorScheme: 'light',
      },
    ])
    expect(manifest.defaultTheme).toBe('emerald')
  })

  it('initial:auto выбирает тему по colorScheme, когда light/dark в сборке нет', () => {
    const manifest = getGranularThemeManifest(options)
    const attributes = new Map<string, string>()
    const target = {
      classList: { add: () => {}, remove: () => {}, contains: () => false },
      getAttribute: (n: string) => attributes.get(n) ?? null,
      setAttribute: (n: string, v: string) => void attributes.set(n, v),
      removeAttribute: (n: string) => void attributes.delete(n),
    }

    const controller = createThemeController(manifest, {
      target,
      storage: null,
      prefersDark: () => true,
    })

    expect(controller.get()).toBe('emerald')
    expect(attributes.get('data-theme')).toBe('emerald')
    expect(controller.entry('sand').label).toBe('Песок')
  })
})

describe('themes.define — node-слой', () => {
  it('эмитит блок app-темы и не эмитит базу, оставшуюся за бортом names', async () => {
    const css = await getGranularThemeCss({
      providers: [structural],
      themes: {
        define: { emerald: { extends: 'light', tokens: { bg: '#052e1f' } } },
      },
    })

    expect(css).toContain('[data-theme="emerald"]')
    expect(css).toContain('--bg: #052e1f')
    expect(css).toContain('--radius: 4px')
    // Селекторы базовых тем провайдера в выводе появиться не должны.
    expect(css).not.toContain('.dark')
    expect(css.match(/:root\s*\{/)).toBeNull()
  })

  it('tokenOverrides применяются ПОСЛЕ define', async () => {
    const css = await getGranularThemeCss({
      providers: [structural],
      themes: {
        define: { emerald: { extends: 'light', selector: '.emerald', tokens: { bg: '#052e1f' } } },
        tokenOverrides: { emerald: { bg: '#0f766e' } },
      },
    })

    expect(css).toContain('.emerald {')
    expect(css).toContain('--bg: #0f766e')
    expect(css).not.toContain('#052e1f')
  })
})

describe('themes.define — tokensRef', () => {
  const dataUrl = `data:text/css,${encodeURIComponent(':root{--bg:#450a0a;--fg:#fee2e2}')}`

  it('значения вычитываются из CSS, литеральные tokens имеют приоритет', () => {
    const materialized = materializeGranularOptions({
      providers: [structural],
      themes: {
        define: {
          crimson: { tokensRef: dataUrl, tokens: { fg: '#ffffff' }, label: 'Багрянец' },
        },
      },
    })

    expect(materialized.themes!.define!.crimson).toEqual({
      tokens: { bg: '#450a0a', fg: '#ffffff' },
      label: 'Багрянец',
    })
  })

  it('as из ссылки становится селектором темы, если selector не задан', () => {
    const options: PresetGranularOptions = {
      providers: [structural],
      themes: {
        define: { crimson: { tokensRef: { url: dataUrl, as: '.crimson' } } },
      },
    }
    const materialized = materializeGranularOptions(options)

    expect(materialized.themes!.define!.crimson.selector).toBe('.crimson')
  })

  it('опции без ссылок возвращаются той же ссылкой — на ней держатся кэши', () => {
    const options = {
      providers: [structural],
      themes: { define: { crimson: { tokens: { bg: '#450a0a' } } } },
    }
    expect(materializeGranularOptions(options)).toBe(options)
  })
})
