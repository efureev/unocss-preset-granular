import { describe, expect, it } from 'vitest'

import { defineGranularProvider, type GranularProvider } from '../contract'
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
})
