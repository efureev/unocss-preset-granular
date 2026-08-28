import type { GranularProvider } from '../contract'

import { describe, expect, it, vi } from 'vitest'
import { defineGranularProvider } from '../contract'
import { resolveThemes } from '../core/resolveThemes'
import { collectTokenLayers } from '../core/tokenLayers'

function provider(theme: GranularProvider['theme']): GranularProvider {
  return defineGranularProvider({
    id: 'p',
    contractVersion: 1,
    packageBaseUrl: 'file:///p/',
    components: [],
    theme,
  })
}

/** Плоский срез: тема → селектор → токен → итоговое значение. */
function flatten(result: ReturnType<typeof collectTokenLayers>): Record<string, Record<string, Record<string, string | undefined>>> {
  const out: Record<string, Record<string, Record<string, string | undefined>>> = {}
  for (const [theme, blocks] of result) {
    out[theme] = {}
    for (const block of blocks) {
      out[theme][block.selector] = {}
      for (const [token, chain] of block.tokens)
        out[theme][block.selector][token] = chain.effective
    }
  }
  return out
}

describe('collectTokenLayers: цепочки слоёв', () => {
  it('провайдер → компонент → app-override: все три слоя в порядке применения', () => {
    const themes = resolveThemes(
      [provider({ tokenDefinitions: { light: { selector: ':root', tokens: { brd: '#aaa' } } } })],
      { names: ['light'] },
      [{ providerId: 'p', descriptor: { name: 'Card', tokenDefinitions: { light: { selector: ':root', tokens: { brd: '#bbb' } } } } }],
    )

    const result = collectTokenLayers(themes, { light: { brd: '#ccc' } })
    const chain = result.get('light')!.find(b => b.selector === ':root')!.tokens.get('brd')!

    expect(chain.layers).toEqual([
      { source: 'provider:p', value: '#aaa' },
      // `componentKey` квалифицирован: имена компонентов уникальны только
      // внутри провайдера, и по одному `source` автора не опознать.
      { source: 'component:Card', value: '#bbb', componentKey: 'p:Card' },
      { source: 'app-override', value: '#ccc' },
    ])
    expect(chain.effective).toBe('#ccc')
  })

  it('токен без overrides несёт один слой и своё значение', () => {
    const themes = resolveThemes(
      [provider({ tokenDefinitions: { light: { tokens: { brd: '#aaa' } } } })],
      { names: ['light'] },
    )
    const chain = collectTokenLayers(themes, undefined).get('light')![0].tokens.get('brd')!
    expect(chain.layers).toEqual([{ source: 'provider:p', value: '#aaa' }])
    expect(chain.effective).toBe('#aaa')
  })
})

describe('collectTokenLayers: strictTokens', () => {
  it('отброшенный override остаётся в layers с пометкой, но не становится effective', () => {
    const themes = resolveThemes(
      [provider({ tokenDefinitions: { light: { selector: ':root', tokens: { brd: '#aaa' } } } })],
      { names: ['light'] },
    )
    const onSkippedOverride = vi.fn()
    const result = collectTokenLayers(
      themes,
      { light: { brd: '#ccc', unknown: '#ddd' } },
      { strictTokens: true, onSkippedOverride },
    )

    const block = result.get('light')!.find(b => b.selector === ':root')!
    // Известный токен override получает.
    expect(block.tokens.get('brd')!.effective).toBe('#ccc')
    // Неизвестный — нет, но факт записи виден.
    const unknown = block.tokens.get('unknown')!
    expect(unknown.effective).toBeUndefined()
    expect(unknown.layers).toEqual([{ source: 'app-override', value: '#ddd', skipped: 'strict-tokens' }])
    expect(onSkippedOverride).toHaveBeenCalledExactlyOnceWith('light', 'unknown')
  })

  it('без strictTokens неизвестный override пишется как есть', () => {
    const themes = resolveThemes(
      [provider({ tokenDefinitions: { light: { selector: ':root', tokens: { brd: '#aaa' } } } })],
      { names: ['light'] },
    )
    const chain = collectTokenLayers(themes, { light: { unknown: '#ddd' } })
      .get('light')![0]
      .tokens
      .get('unknown')!
    expect(chain.effective).toBe('#ddd')
    expect(chain.layers[0].skipped).toBeUndefined()
  })

  it('инвариант: known — имена по всей теме, ПОВЕРХ всех селекторов', () => {
    // Токен объявлен под `.dark`; override целится вложенной формой в другой
    // селектор той же темы. Сузь `known` до одного селектора — и этот override
    // молча отбросится, сломав мультиселекторные темы.
    const themes = resolveThemes(
      [provider({ tokenDefinitions: { dark: { selector: '.dark', tokens: { brd: '#111' } } } })],
      { names: ['dark'] },
    )
    const result = collectTokenLayers(
      themes,
      { dark: { '[data-theme="dark"]': { brd: '#222' } } },
      { strictTokens: true },
    )

    const target = result.get('dark')!.find(b => b.selector === '[data-theme="dark"]')!
    expect(target.tokens.get('brd')!.effective).toBe('#222')
    expect(target.tokens.get('brd')!.layers.at(-1)!.skipped).toBeUndefined()
  })
})

describe('collectTokenLayers: раскладка по селекторам', () => {
  it('инвариант: вложенная форма занимает место в порядке даже когда все её токены отброшены', () => {
    // `ensure(selector)` зовётся ДО цикла по токенам. Селектор с полностью
    // отброшенными токенами всё равно создаётся — и от этого зависит порядок
    // ПОСЛЕДУЮЩИХ селекторов.
    const themes = resolveThemes(
      [provider({ tokenDefinitions: { light: { selector: ':root', tokens: { brd: '#aaa' } } } })],
      { names: ['light'] },
    )
    const result = collectTokenLayers(
      themes,
      { light: { '.a': { nope: '1' }, '.b': { brd: '#222' } } },
      { strictTokens: true },
    )

    expect(result.get('light')!.map(b => b.selector)).toEqual([':root', '.a', '.b'])
    expect(result.get('light')![1].tokens.get('nope')!.effective).toBeUndefined()
  })

  it('плоский override уходит в первичный селектор темы, а не в :root', () => {
    const themes = resolveThemes(
      [provider({ tokenDefinitions: { dark: { selector: '.dark', tokens: { brd: '#111' } } } })],
      { names: ['dark'] },
    )
    const result = collectTokenLayers(themes, { dark: { brd: '#222' } })
    expect(result.get('dark')!.map(b => b.selector)).toEqual(['.dark'])
    expect(result.get('dark')![0].tokens.get('brd')!.effective).toBe('#222')
  })

  it('тема без вкладов, но с overrides, всё равно попадает в результат', () => {
    const themes = resolveThemes([provider({})], { names: ['light'] })
    const result = collectTokenLayers(themes, { light: { brd: '#222' } })
    expect(flatten(result)).toEqual({ light: { ':root': { brd: '#222' } } })
  })

  it('тема без вкладов и без overrides пропускается целиком', () => {
    const themes = resolveThemes([provider({})], { names: ['light'] })
    expect(collectTokenLayers(themes, undefined).has('light')).toBe(false)
  })

  it('мультиселекторная тема сохраняет оба блока в порядке появления', () => {
    const a = defineGranularProvider({
      id: 'a',
      contractVersion: 1,
      packageBaseUrl: 'file:///a/',
      components: [],
      theme: { tokenDefinitions: { dark: { selector: '.dark', tokens: { x: '1' } } } },
    })
    const b = defineGranularProvider({
      id: 'b',
      contractVersion: 1,
      packageBaseUrl: 'file:///b/',
      components: [],
      theme: { tokenDefinitions: { dark: { selector: '[data-theme="dark"]', tokens: { y: '2' } } } },
    })
    const themes = resolveThemes([a, b], { names: ['dark'] })
    expect(flatten(collectTokenLayers(themes, undefined))).toEqual({
      dark: { '.dark': { x: '1' }, '[data-theme="dark"]': { y: '2' } },
    })
  })
})
