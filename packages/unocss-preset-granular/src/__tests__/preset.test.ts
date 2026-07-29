import { describe, expect, it } from 'vitest'

import { defineGranularProvider } from '../contract'
import { GRANULAR_DEFAULT_LAYER, GRANULAR_DEFAULT_LAYER_ORDER } from '../core/layer'
import { presetGranular } from '../preset'

const provider = defineGranularProvider({
  id: 'ds',
  contractVersion: 1,
  packageBaseUrl: 'file:///ds/',
  components: [
    { name: 'DsButton', safelist: ['ds-button', 'ds-button--primary'] },
    { name: 'DsFormField', safelist: ['ds-form-field'], dependencies: ['DsButton'] },
  ],
  unocss: {
    rules: [[/^custom-(.+)$/, ([, v]) => ({ color: v })]],
    preflights: [{ getCSS: async () => '.inline{color:red}' }],
  },
})

describe('presetGranular', () => {
  it('имя и layer', () => {
    const p = presetGranular({ providers: [provider], layer: 'granular' })
    expect(p.name).toBe('granular-preset')
    expect(p.layer).toBe('granular')
  })

  it('layer по умолчанию — granular, с объявленным порядком', () => {
    const p = presetGranular({ providers: [provider], components: ['ds:DsButton'] })
    expect(p.layer).toBe(GRANULAR_DEFAULT_LAYER)
    expect(p.layers).toEqual({ [GRANULAR_DEFAULT_LAYER]: GRANULAR_DEFAULT_LAYER_ORDER })
    expect(p.preflights?.[0].layer).toBe(GRANULAR_DEFAULT_LAYER)
  })

  it('кастомное имя слоя — порядок объявляется для него же', () => {
    const p = presetGranular({ providers: [provider], components: ['ds:DsButton'], layer: 'ds' })
    expect(p.layer).toBe('ds')
    expect(p.layers).toEqual({ ds: GRANULAR_DEFAULT_LAYER_ORDER })
  })

  it('layer: null — слоя нет вовсе', () => {
    const p = presetGranular({ providers: [provider], components: ['ds:DsButton'], layer: null })
    expect(p.layer).toBeUndefined()
    expect(p.layers).toBeUndefined()
    expect(p.preflights?.[0].layer).toBeUndefined()
  })

  it('safelist union с транзитивными deps', () => {
    const p = presetGranular({
      providers: [provider],
      components: ['ds:DsFormField'],
    })
    expect((p.safelist as string[]).sort()).toEqual([
      'ds-button',
      'ds-button--primary',
      'ds-form-field',
    ])
  })

  it('провайдерские rules/preflights включены, layer применён', () => {
    const p = presetGranular({
      providers: [provider],
      components: ['ds:DsButton'],
      layer: 'granular',
    })
    expect(p.rules?.length).toBe(1)
    expect(p.preflights?.length).toBe(1)
    expect(p.preflights?.[0].layer).toBe('granular')
  })

  it('rules транзитивного донора подключаются, даже если его компонент не выбран', () => {
    const donor = defineGranularProvider({
      id: 'donor',
      contractVersion: 1,
      packageBaseUrl: 'file:///donor/',
      components: [{ name: 'DonorOnly', safelist: ['donor-only'] }],
      unocss: { rules: [[/^donor-grad$/, () => ({ color: 'red' })]] },
    })
    const main = defineGranularProvider({
      id: 'main',
      contractVersion: 1,
      packageBaseUrl: 'file:///main/',
      dependencies: [donor],
      components: [{ name: 'M', safelist: ['m'] }],
    })

    const p = presetGranular({ providers: [main], components: ['main:M'] })
    expect(p.rules?.length).toBe(1)
  })

  it('unocss провайдера подключается и при пустой селекции компонентов', () => {
    const p = presetGranular({ providers: [provider], components: [] })
    expect(p.rules?.length).toBe(1)
    expect(p.preflights?.length).toBe(1)
  })

  it('includeProviderUnocss=false отключает rules/preflights', () => {
    const p = presetGranular({
      providers: [provider],
      components: ['ds:DsButton'],
      includeProviderUnocss: false,
    })
    expect(p.rules?.length).toBe(0)
    expect(p.preflights?.length).toBe(0)
  })
})
