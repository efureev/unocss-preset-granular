import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDebug, isDebugEnabled } from '../core/debug'

const original = process.env.DEBUG

afterEach(() => {
  if (original === undefined)
    delete process.env.DEBUG
  else
    process.env.DEBUG = original
  vi.restoreAllMocks()
})

describe('createDebug', () => {
  it('выключен по умолчанию (DEBUG не задан)', () => {
    delete process.env.DEBUG
    expect(isDebugEnabled('granular:resolve')).toBe(false)
  })

  it('включается по namespace, wildcard и `*`', () => {
    process.env.DEBUG = 'granular:resolve'
    expect(isDebugEnabled('granular:resolve')).toBe(true)
    expect(isDebugEnabled('granular:scan')).toBe(false)

    process.env.DEBUG = 'granular:*'
    expect(isDebugEnabled('granular:resolve')).toBe(true)
    expect(isDebugEnabled('granular:scan')).toBe(true)

    process.env.DEBUG = '*'
    expect(isDebugEnabled('granular:scan')).toBe(true)
  })

  it('логирует в stderr только когда включён', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    delete process.env.DEBUG
    createDebug('granular:resolve')('hidden')
    expect(spy).not.toHaveBeenCalled()

    process.env.DEBUG = 'granular:resolve'
    createDebug('granular:resolve')('shown')
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('granular:resolve shown'))
  })
})

describe('createDebug: разбор DEBUG один раз', () => {
  it('выключенный логгер — no-op, состояние берётся из DEBUG на момент создания', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    delete process.env.DEBUG
    const frozen = createDebug('granular:scan')

    // Логгер создан при выключенном DEBUG — включение постфактум его не оживит.
    process.env.DEBUG = 'granular:*'
    frozen('ignored')
    expect(spy).not.toHaveBeenCalled()

    // А новый логгер видит актуальное значение.
    createDebug('granular:scan')('shown')
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('granular:scan shown'))
  })

  it('isDebugEnabled остаётся «живым» — читает DEBUG на каждый вызов', () => {
    delete process.env.DEBUG
    expect(isDebugEnabled('granular:scan')).toBe(false)
    process.env.DEBUG = 'granular:scan'
    expect(isDebugEnabled('granular:scan')).toBe(true)
  })
})
