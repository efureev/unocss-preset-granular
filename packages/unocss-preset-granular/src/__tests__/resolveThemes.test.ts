import type { GranularProvider } from '../contract'

import { describe, expect, it } from 'vitest'
import { defineGranularProvider } from '../contract'
import { GRANULAR_DEFAULT_THEME_NAMES, resolveThemes } from '../core/resolveThemes'

const providerA: GranularProvider = defineGranularProvider({
  id: 'a',
  contractVersion: 1,
  packageBaseUrl: 'file:///a/',
  components: [],
  theme: {
    themes: {
      light: 'file:///a/light.css',
      dark: 'file:///a/dark.css',
    },
  },
})

const providerB: GranularProvider = defineGranularProvider({
  id: 'b',
  contractVersion: 1,
  packageBaseUrl: 'file:///b/',
  components: [],
  theme: {
    themes: {
      light: 'file:///b/light.css', // dark у b нет
    },
  },
})

const providerStructural: GranularProvider = defineGranularProvider({
  id: 's',
  contractVersion: 1,
  packageBaseUrl: 'file:///s/',
  components: [],
  theme: {
    tokenDefinitions: {
      light: {
        selector: ':root',
        tokens: { 'primary-color': 'blue', 'radius': '4px' },
      },
      dark: {
        selector: '[data-theme="dark"]',
        tokens: { 'primary-color': 'lightblue' },
      },
    },
  },
})

describe('resolveThemes', () => {
  it('по умолчанию — только light', () => {
    const r = resolveThemes([providerA, providerB])
    expect(r.names).toEqual(GRANULAR_DEFAULT_THEME_NAMES)
    expect(r.items.map(i => `${i.providerId}:${i.themeName}`)).toEqual([
      'a:light',
      'b:light',
    ])
  })

  it('пустой массив — тем нет', () => {
    const r = resolveThemes([providerA, providerB], { names: [] })
    expect(r.items).toEqual([])
  })

  it('пересечение × имена, пропуск отсутствующих', () => {
    const r = resolveThemes([providerA, providerB], { names: ['light', 'dark'] })
    expect(r.items.map(i => `${i.providerId}:${i.themeName}`)).toEqual([
      'a:light',
      'a:dark',
      'b:light',
    ])
  })

  it('провайдер без темы — игнор', () => {
    const noTheme = defineGranularProvider({
      id: 'n',
      contractVersion: 1,
      packageBaseUrl: 'file:///n/',
      components: [],
    })
    const r = resolveThemes([noTheme, providerA], { names: ['light'] })
    expect(r.items).toEqual([
      { providerId: 'a', themeName: 'light', cssUrl: 'file:///a/light.css' },
    ])
  })

  it('tokenDefinitions имеет приоритет над themes у одного провайдера', () => {
    const mixed = defineGranularProvider({
      id: 'm',
      contractVersion: 1,
      packageBaseUrl: 'file:///m/',
      components: [],
      theme: {
        themes: { light: 'file:///m/light.css' },
        tokenDefinitions: { light: { tokens: { a: '1' } } },
      },
    })
    const r = resolveThemes([mixed], { names: ['light'] })
    expect(r.items[0].tokenDefinition).toBeDefined()
    expect(r.items[0].cssUrl).toBeUndefined()
  })

  it('мержит токены из нескольких провайдеров', () => {
    const s2 = defineGranularProvider({
      id: 's2',
      contractVersion: 1,
      packageBaseUrl: 'file:///s2/',
      components: [],
      theme: {
        tokenDefinitions: {
          light: { tokens: { 'secondary-color': 'red', 'radius': '8px' } },
        },
      },
    })

    const r = resolveThemes([providerStructural, s2], { names: ['light'] })
    expect(r.tokenRegistry.light.tokens).toEqual({
      'primary-color': 'blue',
      'secondary-color': 'red',
      'radius': '8px', // s2 победил, т.к. идет вторым
    })
    expect(r.tokenRegistry.light.selector).toBe(':root') // от первого провайдера
  })

  it('мержит токены из компонентов поверх провайдерских', () => {
    const r = resolveThemes(
      [providerStructural],
      { names: ['light', 'dark'] },
      [
        {
          providerId: 's',
          descriptor: {
            name: 'XTokenized',
            tokenDefinitions: {
              light: { tokens: { 'x-tokenized': 'red', 'primary-color': 'green' } },
              dark: { tokens: { 'x-tokenized': 'yellow' } },
            },
          },
        },
      ],
    )
    expect(r.tokenRegistry.light.tokens).toEqual({
      'primary-color': 'green', // компонент переопределил провайдера
      'radius': '4px',
      'x-tokenized': 'red',
    })
    expect(r.tokenRegistry.dark.tokens).toEqual({
      'primary-color': 'lightblue',
      'x-tokenized': 'yellow',
    })
    // В items должен появиться элемент от компонента
    const fromComponent = r.items.find(i => i.componentName === 'XTokenized' && i.themeName === 'light')
    expect(fromComponent).toBeDefined()
    expect(fromComponent!.tokenDefinition!.tokens['x-tokenized']).toBe('red')
  })

  it('токены компонентов для неактивных тем игнорируются', () => {
    const r = resolveThemes(
      [],
      { names: ['light'] },
      [
        {
          providerId: 'x',
          descriptor: {
            name: 'XTokenized',
            tokenDefinitions: {
              light: { tokens: { 'x-tokenized': 'red' } },
              dark: { tokens: { 'x-tokenized': 'yellow' } }, // не должно попасть
            },
          },
        },
      ],
    )
    expect(r.tokenRegistry.light.tokens).toEqual({ 'x-tokenized': 'red' })
    expect(r.tokenRegistry.dark).toBeUndefined()
    expect(r.items.every(i => i.themeName !== 'dark')).toBe(true)
  })

  it('разные селекторы одной темы дают отдельные блоки (A1)', () => {
    const p1 = defineGranularProvider({
      id: 'p1',
      contractVersion: 1,
      packageBaseUrl: 'file:///p1/',
      components: [],
      theme: { tokenDefinitions: { dark: { selector: '.dark', tokens: { a: '1' } } } },
    })
    const p2 = defineGranularProvider({
      id: 'p2',
      contractVersion: 1,
      packageBaseUrl: 'file:///p2/',
      components: [],
      theme: { tokenDefinitions: { dark: { selector: '[data-theme="dark"]', tokens: { b: '2' } } } },
    })

    const r = resolveThemes([p1, p2], { names: ['dark'] })
    expect(r.tokenRegistry.dark.blocks).toEqual([
      { selector: '.dark', tokens: { a: '1' } },
      { selector: '[data-theme="dark"]', tokens: { b: '2' } },
    ])
    // Алиас первичного блока — первый селектор.
    expect(r.tokenRegistry.dark.selector).toBe('.dark')
    expect(r.tokenRegistry.dark.tokens).toEqual({ a: '1' })
  })

  it('безселекторный вклад мержится в первичный блок, а не плодит :root (A1)', () => {
    const p1 = defineGranularProvider({
      id: 'p1',
      contractVersion: 1,
      packageBaseUrl: 'file:///p1/',
      components: [],
      theme: { tokenDefinitions: { dark: { selector: '.dark', tokens: { a: '1' } } } },
    })
    const r = resolveThemes([p1], { names: ['dark'] }, [
      { providerId: 'p1', descriptor: { name: 'X', tokenDefinitions: { dark: { tokens: { b: '2' } } } } },
    ])
    expect(r.tokenRegistry.dark.blocks).toEqual([{ selector: '.dark', tokens: { a: '1', b: '2' } }])
  })

  it('компонент создаёт тему с нуля, если у провайдеров её нет', () => {
    const r = resolveThemes(
      [providerA],
      { names: ['light'] },
      [
        {
          providerId: 'a',
          descriptor: {
            name: 'XTokenized',
            tokenDefinitions: {
              light: { selector: ':root', tokens: { 'x-tokenized': 'red' } },
            },
          },
        },
      ],
    )
    expect(r.tokenRegistry.light).toBeDefined()
    expect(r.tokenRegistry.light.selector).toBe(':root')
    expect(r.tokenRegistry.light.tokens['x-tokenized']).toBe('red')
  })
})

describe('defaultThemes провайдеров', () => {
  const mk = (id: string, defaults: string[] | undefined, themes: Record<string, string>): GranularProvider =>
    defineGranularProvider({
      id,
      contractVersion: 1,
      packageBaseUrl: `file:///${id}/`,
      components: [],
      theme: {
        themes,
        ...(defaults ? { defaultThemes: defaults } : {}),
      },
    })

  it('без themes.names имена берутся из defaultThemes', () => {
    const p = mk('p', ['brand-day'], { 'brand-day': 'file:///p/day.css' })
    const r = resolveThemes([p])
    expect(r.names).toEqual(['brand-day'])
    expect(r.namesSource).toBe('provider-defaults')
    expect(r.items.map(i => i.cssUrl)).toEqual(['file:///p/day.css'])
  })

  it('объединение по всем провайдерам в порядке провайдеров, с дедупом', () => {
    const p1 = mk('p1', ['light', 'dark'], { light: 'file:///p1/l.css', dark: 'file:///p1/d.css' })
    const p2 = mk('p2', ['dark', 'hc'], { dark: 'file:///p2/d.css', hc: 'file:///p2/hc.css' })
    const r = resolveThemes([p1, p2])
    expect(r.names).toEqual(['light', 'dark', 'hc'])
  })

  it('никто не объявил — жёсткий фолбэк light', () => {
    const r = resolveThemes([mk('p', undefined, { light: 'file:///p/l.css' })])
    expect(r.names).toEqual(GRANULAR_DEFAULT_THEME_NAMES)
    expect(r.namesSource).toBe('fallback')
  })

  it('явные names перебивают defaultThemes', () => {
    const p = mk('p', ['dark'], { light: 'file:///p/l.css', dark: 'file:///p/d.css' })
    const r = resolveThemes([p], { names: ['light'] })
    expect(r.names).toEqual(['light'])
    expect(r.namesSource).toBe('explicit')
  })

  it('names: [] остаётся «тем нет» и при наличии defaultThemes', () => {
    const p = mk('p', ['dark'], { dark: 'file:///p/d.css' })
    const r = resolveThemes([p], { names: [] })
    expect(r.names).toEqual([])
    expect(r.items).toEqual([])
  })

  it('ограничитель: defaultThemes без источника у самого провайдера', () => {
    const p = mk('p', ['dark'], { light: 'file:///p/l.css' })
    const r = resolveThemes([p])
    expect(r.warnings).toContainEqual({
      kind: 'default-theme-without-source',
      providerId: 'p',
      theme: 'dark',
    })
  })

  it('ограничитель: тема покрыта не всеми провайдерами', () => {
    const r = resolveThemes([providerA, providerB], { names: ['dark'] })
    expect(r.warnings).toContainEqual({
      kind: 'partial-theme',
      theme: 'dark',
      providersWithout: ['b'],
    })
  })

  it('ограничитель: по умолчанию активировано больше одной темы', () => {
    const p = mk('p', ['light', 'dark'], { light: 'file:///p/l.css', dark: 'file:///p/d.css' })
    const r = resolveThemes([p])
    expect(r.warnings).toContainEqual({ kind: 'multiple-default-themes', themes: ['light', 'dark'] })
  })

  it('тема, поставляемая только компонентом, не считается «без источника»', () => {
    const p = defineGranularProvider({
      id: 'p',
      contractVersion: 1,
      packageBaseUrl: 'file:///p/',
      components: [{
        name: 'XTokenized',
        tokenDefinitions: { dark: { selector: '.dark', tokens: { brd: '#000' } } },
      }],
      theme: { defaultThemes: ['dark'] },
    })
    const r = resolveThemes([p])
    expect(r.names).toEqual(['dark'])
    expect(r.warnings).toEqual([])
  })

  it('одна тема по умолчанию предупреждений не даёт', () => {
    const p = mk('p', ['light'], { light: 'file:///p/l.css' })
    expect(resolveThemes([p]).warnings).toEqual([])
  })
})
