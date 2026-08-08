import type { GranularProvider } from '../contract'

import { describe, expect, it } from 'vitest'

import { InvalidProviderError } from '../core/errors'
import { expandProviders } from '../core/expandProviders'
import { getGranularNodeCss, GranularCssReadError } from '../preset.node'

function provider(patch: Partial<GranularProvider> = {}): GranularProvider {
  return {
    id: 'pkg',
    contractVersion: 1,
    packageBaseUrl: 'file:///pkg/dist/',
    components: [],
    ...patch,
  } as GranularProvider
}

describe('валидация провайдера при регистрации', () => {
  it('пустой id — ошибка сразу, а не битые ключи providerId:Name', () => {
    expect(() => expandProviders([provider({ id: '   ' })])).toThrow(InvalidProviderError)
    try {
      expandProviders([provider({ id: '' })])
    }
    catch (error) {
      expect((error as InvalidProviderError).reason).toBe('invalid-id')
    }
  })

  it('packageBaseUrl не-URL — ошибка с подсказкой про resolvePackageBaseUrl', () => {
    try {
      expandProviders([provider({ packageBaseUrl: './dist/' })])
      throw new Error('should have thrown')
    }
    catch (error) {
      expect(error).toBeInstanceOf(InvalidProviderError)
      expect((error as InvalidProviderError).reason).toBe('invalid-package-base-url')
      expect((error as Error).message).toContain('resolvePackageBaseUrl')
    }
  })

  it('packageBaseUrl без завершающего слеша — ошибка (иначе скан уезжает уровнем выше)', () => {
    try {
      expandProviders([provider({ packageBaseUrl: 'file:///pkg/dist' })])
      throw new Error('should have thrown')
    }
    catch (error) {
      expect((error as InvalidProviderError).reason).toBe('package-base-url-not-a-directory')
    }
  })

  it('рассинхрон cssFiles / cssFileAssetNames — ошибка с именем компонента', () => {
    const broken = provider({
      components: [{
        name: 'Btn',
        cssFiles: ['file:///pkg/src/components/Btn/a.css', 'file:///pkg/src/components/Btn/b.css'],
        cssFileAssetNames: ['components/Btn/a.css'],
      }],
    })

    try {
      expandProviders([broken])
      throw new Error('should have thrown')
    }
    catch (error) {
      expect((error as InvalidProviderError).reason).toBe('css-files-length-mismatch')
      expect((error as InvalidProviderError).componentName).toBe('Btn')
    }
  })

  it('корректный провайдер проходит без изменений', () => {
    const ok = provider({ components: [{ name: 'Btn', safelist: ['btn'] }] })
    expect(expandProviders([ok])).toEqual([ok])
  })
})

describe('контекст в ошибке чтения CSS', () => {
  it('называет провайдера, секцию и компонент вместо голого ENOENT', async () => {
    const withMissingCss = provider({
      id: '@scope/ds',
      components: [{
        name: 'Btn',
        cssFiles: ['file:///pkg/dist/components/Btn/styles.css'],
      }],
    })

    await expect(getGranularNodeCss({ providers: [withMissingCss], components: 'all' }))
      .rejects
      .toThrow(GranularCssReadError)

    const error = await getGranularNodeCss({ providers: [withMissingCss], components: 'all' })
      .then(() => null, (e: unknown) => e as GranularCssReadError)
    expect(error).toBeInstanceOf(GranularCssReadError)
    if (!error)
      throw new Error('unreachable')

    expect(error.message).toContain('component \'Btn\'')
    expect(error.message).toContain('provider \'@scope/ds\'')
    expect(error.message).toContain('components/Btn/styles.css')
    // Исходная причина не теряется.
    expect((error.cause as NodeJS.ErrnoException)?.code).toBe('ENOENT')
  })

  it('для файла темы указывает имя темы', async () => {
    const withMissingTheme = provider({
      id: '@scope/ds',
      theme: { themes: { light: 'file:///pkg/dist/themes/light.css' } },
    })

    const error = await getGranularNodeCss({ providers: [withMissingTheme], themes: { names: ['light'] } })
      .then(() => null, (e: unknown) => e as GranularCssReadError)

    expect(error).toBeInstanceOf(GranularCssReadError)
    if (!error)
      throw new Error('unreachable')
    expect(error.message).toContain('theme \'light\'')
    expect(error.message).toContain('provider \'@scope/ds\'')
  })
})
