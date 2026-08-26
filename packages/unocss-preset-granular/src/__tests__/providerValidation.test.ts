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

  it('вклад строк без локалей — ошибка: без списка остаётся только агрегат', () => {
    try {
      expandProviders([provider({ i18n: { locales: [] } })])
      throw new Error('should have thrown')
    }
    catch (error) {
      expect(error).toBeInstanceOf(InvalidProviderError)
      expect((error as InvalidProviderError).reason).toBe('invalid-i18n-locales')
      // Сообщение обязано назвать подпуть, иначе автор пакета не поймёт, где искать.
      expect((error as Error).message).toContain('pkg/i18n')
    }
  })

  it('локаль не-строка — ошибка: она уезжает как имя именованного экспорта', () => {
    try {
      expandProviders([provider({ i18n: { locales: ['en', 42 as unknown as string] } })])
      throw new Error('should have thrown')
    }
    catch (error) {
      expect((error as InvalidProviderError).reason).toBe('invalid-i18n-locales')
    }
  })

  it('пустой entry — ошибка с подсказкой про дефолт', () => {
    try {
      expandProviders([provider({ i18n: { locales: ['en'], entry: '  ' } })])
      throw new Error('should have thrown')
    }
    catch (error) {
      expect((error as InvalidProviderError).reason).toBe('invalid-i18n-entry')
      expect((error as Error).message).toContain('pkg/i18n')
    }
  })

  it('пустой allEntry — ошибка, дефолт считается от entry', () => {
    try {
      expandProviders([provider({ i18n: { locales: ['en'], entry: 'x/i18n', allEntry: '' } })])
      throw new Error('should have thrown')
    }
    catch (error) {
      expect((error as InvalidProviderError).reason).toBe('invalid-i18n-entry')
      expect((error as Error).message).toContain('x/i18n/all')
    }
  })

  it('отсутствие i18n — не ошибка: это и есть «у пакета нет строк»', () => {
    expect(() => expandProviders([provider()])).not.toThrow()
    expect(() => expandProviders([provider({ i18n: { locales: ['en', 'ru'] } })])).not.toThrow()
  })

  it('i18n не объект — типизированная ошибка, а не падение на чтении поля', () => {
    try {
      expandProviders([provider({ i18n: null as never })])
      throw new Error('should have thrown')
    }
    catch (error) {
      expect(error).toBeInstanceOf(InvalidProviderError)
      expect((error as InvalidProviderError).reason).toBe('invalid-i18n-contribution')
    }
  })

  it('повтор локали — ошибка: это дубль импорта одной коллекции', () => {
    try {
      expandProviders([provider({ i18n: { locales: ['en', 'EN'] } })])
      throw new Error('should have thrown')
    }
    catch (error) {
      expect((error as InvalidProviderError).reason).toBe('invalid-i18n-locales')
    }
  })

  it('entry с пробелами по краям — ошибка: спецификатор уезжает в манифест как есть', () => {
    try {
      expandProviders([provider({ i18n: { locales: ['en'], entry: ' pkg/i18n ' } })])
      throw new Error('should have thrown')
    }
    catch (error) {
      expect((error as InvalidProviderError).reason).toBe('invalid-i18n-entry')
    }
  })

  it('тег, из которого не выводится идентификатор, — ошибка с подсказкой про exportNames', () => {
    try {
      // `import { 1337 }` невозможно синтаксически. Конвенция вытягивает `pt-BR`
      // в `ptBR`, но не всё: то, что она не вытянула, обязано быть названо явно,
      // иначе генератор напишет битый импорт уже у потребителя.
      expandProviders([provider({ i18n: { locales: ['1337'] } })])
      throw new Error('should have thrown')
    }
    catch (error) {
      expect((error as InvalidProviderError).reason).toBe('invalid-i18n-export-name')
      expect((error as Error).message).toContain('exportNames')
    }
  })

  it('exportNames для тега вне locales — ошибка: это override, а не второй список', () => {
    try {
      expandProviders([provider({ i18n: { locales: ['en'], exportNames: { de: 'de' } } })])
      throw new Error('should have thrown')
    }
    catch (error) {
      expect((error as InvalidProviderError).reason).toBe('invalid-i18n-export-name')
    }
  })

  it('exportNames не-идентификатор — ошибка', () => {
    try {
      expandProviders([provider({ i18n: { locales: ['pt-BR'], exportNames: { 'pt-BR': 'pt-BR' } } })])
      throw new Error('should have thrown')
    }
    catch (error) {
      expect((error as InvalidProviderError).reason).toBe('invalid-i18n-export-name')
    }
  })

  it('регион проходит по конвенции и с явным именем', () => {
    // `pt-BR` → `ptBR` выводится сам; поле нужно только тем, кто от конвенции отступил.
    expect(() => expandProviders([provider({ i18n: { locales: ['en', 'pt-BR'] } })])).not.toThrow()
    expect(() => expandProviders([
      provider({ i18n: { locales: ['en', 'pt-BR'], exportNames: { 'pt-BR': 'brazilian' } } }),
    ])).not.toThrow()
  })

  it('два провайдера могут объявить один блок: имён блоков в контракте нет', () => {
    // Столкновение блоков — штатный мердж лоадеров в fint-i18n, а не ошибка.
    // Контракт имён блоков не несёт, поэтому детектировать здесь нечего и
    // регистрация обязана пройти.
    const a = provider({ id: 'a', i18n: { locales: ['en'] } })
    const b = provider({ id: 'b', i18n: { locales: ['en'] } })
    expect(() => expandProviders([a, b])).not.toThrow()
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
