import type { GranularProvider } from '../contract'
import type { ResolvedThemeItem } from '../core/resolveThemes'

import { describe, expect, it } from 'vitest'
import { resolveInlinedCssSources } from '../node-utils/inlinedCss'

function provider(id: string, theme?: GranularProvider['theme']): GranularProvider {
  return { id, contractVersion: 1, packageBaseUrl: `file:///${id}/`, components: [], ...(theme ? { theme } : {}) }
}

const a = provider('a', { tokensCssUrl: 'file:///a/tokens.css', baseCssUrl: 'file:///a/base.css' })
const b = provider('b', { tokensCssUrl: 'file:///b/tokens.css' })

const urls = (sources: ReturnType<typeof resolveInlinedCssSources>): string[] => sources.map(s => s.url)

describe('resolveInlinedCssSources: base и tokens', () => {
  it('без override берутся провайдерские, tokens раньше base', () => {
    expect(urls(resolveInlinedCssSources([a, b], [], undefined)))
      .toEqual(['file:///a/tokens.css', 'file:///b/tokens.css', 'file:///a/base.css'])
  })

  it('строковый tokensFile ВЫТЕСНЯЕТ провайдерские, а не добавляется к ним', () => {
    // Ровно это расхождение делало `token-undefined` слепым: эмиссия заменяет,
    // а диагностика складывала оба файла в одно множество «заданного».
    const sources = resolveInlinedCssSources([a, b], [], { tokensFile: 'file:///app/t.css' })
    expect(urls(sources)).toEqual(['file:///app/t.css', 'file:///a/base.css'])
    expect(sources[0].owner).toBe('app')
  })

  it('строковый override эмитится один раз даже у провайдера без темы', () => {
    const noTheme = provider('c')
    expect(urls(resolveInlinedCssSources([a, noTheme], [], { baseFile: 'file:///app/b.css' })))
      .toEqual(['file:///a/tokens.css', 'file:///app/b.css'])
  })

  it('объектная форма вытесняет точечно и помечает владельца приложением', () => {
    const sources = resolveInlinedCssSources([a, b], [], { tokensFile: { a: 'file:///app/only-a.css' } })
    expect(urls(sources)).toEqual(['file:///app/only-a.css', 'file:///b/tokens.css', 'file:///a/base.css'])
    // Метка обязана быть честной: из неё выводится происхождение токена.
    expect(sources[0].owner).toBe('app')
    expect(sources[1].owner).toBe('provider')
  })

  it('провайдер вне объекта override сохраняет собственный файл', () => {
    const sources = resolveInlinedCssSources([a, b], [], { tokensFile: { b: 'file:///app/only-b.css' } })
    expect(urls(sources)).toContain('file:///a/tokens.css')
    expect(sources.find(s => s.url === 'file:///a/tokens.css')!.owner).toBe('provider')
  })

  it('одинаковый URL у tokens и base эмитится один раз', () => {
    const same = provider('s', { tokensCssUrl: 'file:///s/x.css', baseCssUrl: 'file:///s/x.css' })
    expect(urls(resolveInlinedCssSources([same], [], undefined))).toEqual(['file:///s/x.css'])
  })
})

describe('resolveInlinedCssSources: файлы тем', () => {
  const items: ResolvedThemeItem[] = [
    { providerId: 'a', themeName: 'light', cssUrl: 'file:///a/light.css' },
    { providerId: 'b', themeName: 'light', cssUrl: 'file:///b/light.css' },
  ]

  it('берёт cssUrl из items и помечает темой', () => {
    const themeSources = resolveInlinedCssSources([], items, undefined)
    expect(urls(themeSources)).toEqual(['file:///a/light.css', 'file:///b/light.css'])
    expect(themeSources[0].theme).toBe('light')
  })

  it('themeFiles строкой сводит всех провайдеров темы к одному файлу', () => {
    const sources = resolveInlinedCssSources([], items, { themeFiles: { light: 'file:///app/l.css' } })
    expect(urls(sources)).toEqual(['file:///app/l.css'])
    expect(sources[0].owner).toBe('app')
  })

  it('themeFiles объектной формой подменяет одного, остальным оставляет своё', () => {
    const sources = resolveInlinedCssSources([], items, { themeFiles: { light: { a: 'file:///app/a.css' } } })
    expect(urls(sources)).toEqual(['file:///app/a.css', 'file:///b/light.css'])
  })

  it('структурная тема файла не даёт: у такого item нет cssUrl', () => {
    // `resolveThemes` разводит структурные и файловые через `else if`, поэтому
    // обход по `items` исключает файл, который в CSS не уедет. Чтение
    // `provider.theme.themes[name]` напрямую такой файл бы захватило.
    const structural: ResolvedThemeItem[] = [
      { providerId: 'a', themeName: 'light', tokenDefinition: { selector: ':root', tokens: { x: '1' } } },
    ]
    expect(resolveInlinedCssSources([], structural, undefined)).toEqual([])
  })
})
