import type { GranularProvider } from '../contract'

import { describe, expect, it } from 'vitest'
import { defineGranularProvider } from '../contract'
import {
  CircularDependencyError,
  ComponentNotFoundError,
  DuplicateComponentNameError,
  DuplicateProviderIdError,
  InvalidComponentKeyError,
  ProviderNotRegisteredError,
} from '../core/errors'
import { buildRegistry } from '../core/registry'
import {
  collectCssFilesDetailed,
  collectSafelist,
  resolveSelection,
} from '../core/resolveSelection'

const P_DS: GranularProvider = defineGranularProvider({
  id: 'ds',
  contractVersion: 1,
  packageBaseUrl: 'file:///ds/',
  components: [
    { name: 'DsButton', safelist: ['ds-button'], cssFiles: ['file:///ds/DsButton.css'] },
    { name: 'DsInput', safelist: ['ds-input'], cssFiles: ['file:///ds/DsInput.css'] },
    { name: 'DsFormField', safelist: ['ds-form-field'], dependencies: ['DsInput'] },
  ],
})

const P_XG: GranularProvider = defineGranularProvider({
  id: 'xg',
  contractVersion: 1,
  packageBaseUrl: 'file:///xg/',
  components: [
    {
      name: 'XgFormActions',
      safelist: ['xg-form-actions'],
      dependencies: ['ds:DsButton'],
    },
    {
      name: 'XgQuickForm',
      safelist: ['xg-quick-form'],
      dependencies: [
        'XgFormActions',
        'ds:DsInput',
        { provider: 'ds', components: ['DsFormField'] },
      ],
    },
  ],
})

describe('buildRegistry', () => {
  it('ругается на дубли провайдеров', () => {
    expect(() => buildRegistry([P_DS, P_DS])).toThrowError(DuplicateProviderIdError)
  })

  it('ругается на дубли имён компонентов внутри провайдера', () => {
    const dup = defineGranularProvider({
      id: 'dup',
      contractVersion: 1,
      packageBaseUrl: 'file:///dup/',
      components: [
        { name: 'Same', safelist: [] },
        { name: 'Same', safelist: [] },
      ],
    })
    expect(() => buildRegistry([dup])).toThrowError(DuplicateComponentNameError)
  })
})

describe('resolveSelection', () => {
  it('все компоненты всех провайдеров при selection=undefined', () => {
    const r = resolveSelection(buildRegistry([P_DS, P_XG]), undefined)
    expect([...r.order].sort()).toEqual([
      'ds:DsButton',
      'ds:DsFormField',
      'ds:DsInput',
      'xg:XgFormActions',
      'xg:XgQuickForm',
    ])
  })

  it('транзитивные cross-provider deps подтягиваются автоматически', () => {
    const r = resolveSelection(buildRegistry([P_DS, P_XG]), ['xg:XgQuickForm'])
    expect(new Set(r.order)).toEqual(new Set([
      'ds:DsButton',
      'ds:DsInput',
      'ds:DsFormField',
      'xg:XgFormActions',
      'xg:XgQuickForm',
    ]))
    // post-order: XgQuickForm последним
    expect(r.order[r.order.length - 1]).toBe('xg:XgQuickForm')
  })

  it('selection={provider,names} + objектная форма dep', () => {
    const r = resolveSelection(buildRegistry([P_DS, P_XG]), [
      { provider: 'xg', names: ['XgFormActions'] },
    ])
    expect(r.order).toContain('ds:DsButton')
    expect(r.order).toContain('xg:XgFormActions')
  })

  it('names=all раскрывается', () => {
    const r = resolveSelection(buildRegistry([P_DS]), [{ provider: 'ds', names: 'all' }])
    expect([...r.order].sort()).toEqual(['ds:DsButton', 'ds:DsFormField', 'ds:DsInput'])
  })

  it('разделитель — ПОСЛЕДНЕЕ двоеточие: id провайдера может их содержать', () => {
    const scoped = defineGranularProvider({
      id: '@scope/pkg:sub',
      contractVersion: 1,
      packageBaseUrl: 'file:///scoped/',
      components: [{ name: 'Btn', safelist: ['btn'] }],
    })
    const r = resolveSelection(buildRegistry([scoped]), ['@scope/pkg:sub:Btn'])
    expect(r.order).toEqual(['@scope/pkg:sub:Btn'])
  })

  it('короткая форма без провайдера в components — типизированная ошибка', () => {
    expect(() => resolveSelection(buildRegistry([P_DS]), ['DsButton']))
      .toThrowError(InvalidComponentKeyError)
    expect(() => resolveSelection(buildRegistry([P_DS]), ['DsButton']))
      .toThrowError(/Invalid component key/)
  })

  it('пустая сторона ключа (":X" / "X:") — типизированная ошибка с полем key', () => {
    for (const bad of [':X', 'X:']) {
      try {
        resolveSelection(buildRegistry([P_DS]), [bad])
        throw new Error('should have thrown')
      }
      catch (error) {
        expect(error).toBeInstanceOf(InvalidComponentKeyError)
        expect((error as InvalidComponentKeyError).key).toBe(bad)
      }
    }
  })

  it('ошибка если провайдер не зарегистрирован (через dep)', () => {
    expect(() =>
      resolveSelection(buildRegistry([P_XG]), ['xg:XgQuickForm']),
    ).toThrowError(ProviderNotRegisteredError)
  })

  it('ошибка если компонент не найден', () => {
    expect(() =>
      resolveSelection(buildRegistry([P_DS]), ['ds:Nope']),
    ).toThrowError(ComponentNotFoundError)
  })

  it('детектит циклы', () => {
    const cyclic = defineGranularProvider({
      id: 'c',
      contractVersion: 1,
      packageBaseUrl: 'file:///c/',
      components: [
        { name: 'A', safelist: [], dependencies: ['B'] },
        { name: 'B', safelist: [], dependencies: ['A'] },
      ],
    })
    expect(() => resolveSelection(buildRegistry([cyclic]), ['c:A']))
      .toThrowError(CircularDependencyError)
  })

  it('safelist собирается как union всех посещённых', () => {
    const r = resolveSelection(buildRegistry([P_DS, P_XG]), ['xg:XgQuickForm'])
    const safe = collectSafelist(r.entries).sort()
    expect(safe).toEqual([
      'ds-button',
      'ds-form-field',
      'ds-input',
      'xg-form-actions',
      'xg-quick-form',
    ])
  })

  it('cssFiles дедуплицируются', () => {
    const r = resolveSelection(buildRegistry([P_DS]), [
      'ds:DsButton',
      { provider: 'ds', names: ['DsButton'] },
    ])
    expect(collectCssFilesDetailed(r.entries).map(f => f.url))
      .toEqual(['file:///ds/DsButton.css'])
  })
})
