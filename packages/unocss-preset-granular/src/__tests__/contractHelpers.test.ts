import { describe, expect, it } from 'vitest'

import { resolvePackageBaseUrl } from '../contract'

describe('resolvePackageBaseUrl', () => {
  it('по умолчанию поднимается на один уровень от модуля', () => {
    // dev: <base>/granular-provider/index.ts → <base>/
    expect(resolvePackageBaseUrl('file:///pkg/src/granular-provider/index.ts'))
      .toBe('file:///pkg/src/')
    // build: <base>/chunks/granular-provider-abc.js → <base>/
    expect(resolvePackageBaseUrl('file:///pkg/dist/chunks/granular-provider-a1b2.js'))
      .toBe('file:///pkg/dist/')
  })

  it('levelsUp=0 — директория самого модуля', () => {
    expect(resolvePackageBaseUrl('file:///pkg/dist/granular-provider.js', 0))
      .toBe('file:///pkg/dist/')
  })

  it('levelsUp>1 поднимается на несколько уровней', () => {
    expect(resolvePackageBaseUrl('file:///pkg/dist/a/b/mod.js', 2))
      .toBe('file:///pkg/dist/')
  })

  it('результат всегда со слешем на конце — это база для new URL(...)', () => {
    const base = resolvePackageBaseUrl('file:///pkg/dist/chunks/mod.js')
    expect(base.endsWith('/')).toBe(true)
    expect(new URL('components/X/styles.css', base).href)
      .toBe('file:///pkg/dist/components/X/styles.css')
  })

  it('работает не только с file: URL', () => {
    expect(resolvePackageBaseUrl('https://cdn.example.com/pkg/dist/chunks/mod.js'))
      .toBe('https://cdn.example.com/pkg/dist/')
  })

  it('не даёт молча уехать выше корня', () => {
    expect(() => resolvePackageBaseUrl('file:///mod.js', 5)).toThrow(RangeError)
  })

  it('валидирует аргументы', () => {
    expect(() => resolvePackageBaseUrl('')).toThrow(TypeError)
    expect(() => resolvePackageBaseUrl('no-separator-here')).toThrow(TypeError)
    expect(() => resolvePackageBaseUrl('file:///a/b.js', -1)).toThrow(TypeError)
    expect(() => resolvePackageBaseUrl('file:///a/b.js', 1.5)).toThrow(TypeError)
  })

  it('эквивалентен рукописному слайсу, который вытесняет', () => {
    const url = 'file:///pkg/dist/chunks/granular-provider-a1b2.js'
    const legacy = `${url.slice(0, url.lastIndexOf('/', url.lastIndexOf('/') - 1) + 1)}`
    expect(resolvePackageBaseUrl(url)).toBe(legacy)
  })
})
