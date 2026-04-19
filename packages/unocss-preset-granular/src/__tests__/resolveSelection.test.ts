import { describe, expect, it } from 'vitest'

import { defineGranularProvider, type GranularProvider } from '../contract'
import { buildRegistry } from '../core/registry'
import {
  collectCssFiles,
  collectSafelist,
  resolveSelection,
} from '../core/resolveSelection'
import {
  CircularDependencyError,
  ComponentNotFoundError,
  DuplicateProviderIdError,
  ProviderNotRegisteredError,
} from '../core/errors'

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
})

describe('resolveSelection', () => {
  it('все компоненты всех провайдеров при selection=undefined', () => {
    const r = resolveSelection(buildRegistry([P_DS, P_XG]), undefined)
    expect(r.order.sort()).toEqual([
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
    expect(r.order.sort()).toEqual(['ds:DsButton', 'ds:DsFormField', 'ds:DsInput'])
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
    expect(collectCssFiles(r.entries)).toEqual(['file:///ds/DsButton.css'])
  })
})
