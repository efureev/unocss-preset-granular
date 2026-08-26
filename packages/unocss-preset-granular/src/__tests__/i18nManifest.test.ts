import type { GranularProvider } from '../contract'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { defineGranularProvider } from '../contract'
import { localeExportName, matchLocale } from '../core/i18nLocales'
import { getGranularI18nManifest, GRANULAR_I18N_MODULE_ID, granularI18nPlugin } from '../node-utils/i18nManifest'

function provider(id: string, patch: Partial<GranularProvider> = {}): GranularProvider {
  return defineGranularProvider({
    id,
    contractVersion: 1,
    packageBaseUrl: `file:///${id.replace(/[@/]/g, '_')}/dist/`,
    components: [],
    ...patch,
  })
}

const core = provider('@feugene/granularity', {
  components: [{ name: 'GrButton' }],
  i18n: { locales: ['en', 'ru', 'es'] },
})

const chrono = provider('@feugene/granularity-chrono', {
  components: [{ name: 'GrCalendar' }],
  i18n: { locales: ['en', 'ru'] },
})

/** Пакет без строк — вклад отсутствует, и это не ошибка. */
const datasource = provider('@feugene/granularity-datasource', {
  components: [{ name: 'GrDataSource' }],
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('имя экспорта локали', () => {
  it('тег без региона остаётся собой', () => {
    expect(localeExportName('en')).toBe('en')
  })

  it('регион уезжает в camelCase — дефис в идентификаторе стоять не может', () => {
    expect(localeExportName('pt-BR')).toBe('ptBR')
    expect(localeExportName('en-GB')).toBe('enGB')
    expect(localeExportName('zh-Hans')).toBe('zhHans')
  })
})

describe('подбор локали', () => {
  it('точное совпадение — без учёта регистра, отдаётся написание пакета', () => {
    expect(matchLocale(['ru'], 'ru')).toMatchObject({ locale: 'ru', via: 'exact' })
    expect(matchLocale(['pt-BR'], 'pt-br')).toMatchObject({ locale: 'pt-BR', via: 'exact' })
  })

  it('региональный подтег обслуживается базовым языком', () => {
    expect(matchLocale(['ru'], 'ru-RU')).toMatchObject({ locale: 'ru', via: 'base' })
  })

  it('обратный шаг: запрошен базовый, объявлен только регион', () => {
    // Без этого шага пакет молча выпал бы из сборки, и `negotiateLocale` в
    // рантайме не смог бы выбрать `ru-RU`: локали нет в бандле.
    expect(matchLocale(['ru-RU'], 'ru')).toMatchObject({ locale: 'ru-RU', via: 'region' })
  })

  it('точное совпадение выигрывает у базового и у региона', () => {
    expect(matchLocale(['ru', 'ru-RU'], 'ru-RU')).toMatchObject({ locale: 'ru-RU', via: 'exact' })
    expect(matchLocale(['ru', 'ru-RU'], 'ru')).toMatchObject({ locale: 'ru', via: 'exact' })
  })

  it('базовый выигрывает у региона', () => {
    expect(matchLocale(['ru', 'ru-BY'], 'ru-RU')).toMatchObject({ locale: 'ru', via: 'base' })
  })

  it('неоднозначный регион отдаёт первый в порядке объявления и называет остальных', () => {
    expect(matchLocale(['ru-RU', 'ru-BY'], 'ru')).toMatchObject({
      locale: 'ru-RU',
      via: 'region',
      alternatives: ['ru-BY'],
    })
  })

  it('не путает разные языки с общим префиксом', () => {
    expect(matchLocale(['r'], 'ru')).toBeUndefined()
    expect(matchLocale(['ru'], 'rue')).toBeUndefined()
  })

  it('промежуточный тег ловится обратным шагом, а не усечением', () => {
    // Усечение — на один уровень: базовый язык `zh-Hans-CN` это `zh`, не
    // `zh-Hans`. Сам `zh-Hans` подхватывает третий шаг каскада — ровно как
    // `negotiateLocale`, который вернул бы его же.
    expect(matchLocale(['zh-Hans'], 'zh-Hans-CN')).toMatchObject({ locale: 'zh-Hans', via: 'region' })
    // Но объявленный базовый выигрывает у более точного промежуточного —
    // и здесь пресет тоже повторяет порядок шагов рантайма.
    expect(matchLocale(['zh', 'zh-Hans'], 'zh-Hans-CN')).toMatchObject({ locale: 'zh', via: 'base' })
  })
})

describe('манифест строк', () => {
  it('включает только провайдеров со вкладом', () => {
    const manifest = getGranularI18nManifest({
      providers: [core, chrono, datasource],
      components: 'all',
    })

    expect(manifest.entries.map(e => e.providerId)).toEqual([
      '@feugene/granularity',
      '@feugene/granularity-chrono',
    ])
  })

  it('подставляет подпути по конвенции fint-i18n', () => {
    const manifest = getGranularI18nManifest({ providers: [core], components: 'all' })

    expect(manifest.entries[0]).toMatchObject({
      entry: '@feugene/granularity/i18n',
      allEntry: '@feugene/granularity/i18n/all',
    })
  })

  it('явные подпути перекрывают дефолт, а allEntry считается от entry', () => {
    const custom = provider('pkg', { i18n: { locales: ['en'], entry: 'pkg/strings' } })
    const manifest = getGranularI18nManifest({ providers: [custom], components: 'all' })

    expect(manifest.entries[0]).toMatchObject({
      entry: 'pkg/strings',
      allEntry: 'pkg/strings/all',
    })
  })

  it('без запроса локалей отдаёт все объявленные', () => {
    const manifest = getGranularI18nManifest({ providers: [core, chrono], components: 'all' })

    expect(manifest.entries[0].bindings.map(b => b.locale)).toEqual(['en', 'ru', 'es'])
    expect(manifest.locales).toEqual(['en', 'ru', 'es'])
    expect(manifest.unserved).toEqual([])
  })

  it('пересечение отсекает языки, которых приложению не нужно', () => {
    const manifest = getGranularI18nManifest(
      { providers: [core, chrono], components: 'all' },
      { locales: ['en', 'ru'] },
    )

    // `es` объявлен ядром, но приложению не нужен — в импорты не уедет.
    expect(manifest.entries[0].locales).toContain('es')
    expect(manifest.entries[0].bindings.map(b => b.locale)).toEqual(['en', 'ru'])
    expect(manifest.locales).toEqual(['en', 'ru'])
  })

  it('связка несёт имя импорта, а не тег', () => {
    const brazil = provider('pkg', { i18n: { locales: ['pt-BR'] } })
    const manifest = getGranularI18nManifest({ providers: [brazil], components: 'all' })

    expect(manifest.entries[0].bindings[0]).toMatchObject({ locale: 'pt-BR', exportName: 'ptBR' })
  })

  it('exportNames перекрывает конвенцию', () => {
    const odd = provider('pkg', {
      i18n: { locales: ['en', 'pt-BR'], exportNames: { 'pt-BR': 'brazilian' } },
    })
    const manifest = getGranularI18nManifest({ providers: [odd], components: 'all' })

    expect(manifest.entries[0].bindings.map(b => b.exportName)).toEqual(['en', 'brazilian'])
  })

  it('региональный запрос обслуживается базовым языком пакета', () => {
    const manifest = getGranularI18nManifest(
      { providers: [core], components: 'all' },
      { locales: ['ru-RU'] },
    )

    // Импортировать надо `ru` — именно он экспортирован пакетом.
    expect(manifest.entries[0].bindings).toEqual([
      { locale: 'ru', exportName: 'ru', serves: ['ru-RU'], via: 'base' },
    ])
  })

  it('две запрошенные локали одного языка дают ОДИН импорт', () => {
    const manifest = getGranularI18nManifest(
      { providers: [core], components: 'all' },
      { locales: ['ru', 'ru-RU'] },
    )

    // Иначе один и тот же словарь уехал бы в бандл дважды.
    expect(manifest.entries[0].bindings).toEqual([
      { locale: 'ru', exportName: 'ru', serves: ['ru', 'ru-RU'], via: 'exact' },
    ])
    expect(manifest.locales).toEqual(['ru'])
  })

  it('точное совпадение не тянет за собой базовый лоадер', () => {
    // fint-i18n: «an exact match always wins» — базовый `ru` был бы мёртвым
    // грузом, а словарь хранился бы дважды.
    const both = provider('pkg', { i18n: { locales: ['ru', 'ru-RU'] } })
    const manifest = getGranularI18nManifest(
      { providers: [both], components: 'all' },
      { locales: ['ru-RU'] },
    )

    expect(manifest.entries[0].bindings.map(b => b.locale)).toEqual(['ru-RU'])
  })

  it('обратный шаг доносит пакет, у которого только региональный вариант', () => {
    const regional = provider('pkg', { i18n: { locales: ['ru-RU'] } })
    const manifest = getGranularI18nManifest(
      { providers: [regional], components: 'all' },
      { locales: ['ru'] },
    )

    expect(manifest.entries[0].bindings[0]).toMatchObject({ locale: 'ru-RU', via: 'region' })
    expect(manifest.locales).toEqual(['ru-RU'])
  })

  it('неоднозначный обратный шаг предупреждает вслух', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ambiguous = provider('pkg', { i18n: { locales: ['ru-RU', 'ru-BY'] } })

    getGranularI18nManifest({ providers: [ambiguous], components: 'all' }, { locales: ['ru'] })

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain(`'ru-RU'`)
    expect(warn.mock.calls[0][0]).toContain(`'ru-BY'`)
  })

  it('однозначный подбор молчит', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    getGranularI18nManifest({ providers: [core], components: 'all' }, { locales: ['ru-RU'] })

    expect(warn).not.toHaveBeenCalled()
  })

  it('пакет без запрошенных языков остаётся в манифесте с пустыми связками', () => {
    const manifest = getGranularI18nManifest(
      { providers: [core, chrono], components: 'all' },
      { locales: ['es'] },
    )

    // Молча выбрасывать нельзя: потребитель обязан иметь возможность сказать,
    // что у пакета нет запрошенного языка. Пропавший пакет выглядит как
    // «строки не работают», и причину ищут не там.
    const byId = Object.fromEntries(manifest.entries.map(e => [e.providerId, e]))
    expect(byId['@feugene/granularity'].bindings.map(b => b.locale)).toEqual(['es'])
    expect(byId['@feugene/granularity-chrono'].bindings).toEqual([])
  })

  it('язык, которого нет ни у кого, попадает в unserved', () => {
    const manifest = getGranularI18nManifest(
      { providers: [core, chrono], components: 'all' },
      { locales: ['en', 'de', 'de'] },
    )

    // В рантайме `negotiateLocale` просто свалится в fallback — сборка
    // единственное место, где промах вообще виден.
    expect(manifest.unserved).toEqual(['de'])
  })

  it('onlySelected оставляет только провайдеров, чьи компоненты в сборке', () => {
    const all = getGranularI18nManifest(
      { providers: [core, chrono], components: [{ provider: '@feugene/granularity', names: ['GrButton'] }] },
      { onlySelected: true },
    )

    expect(all.entries.map(e => e.providerId)).toEqual(['@feugene/granularity'])
  })

  it('onlySelected не трогает пакет без компонентов', () => {
    // Спутник, у которого строки — единственный вклад: через компоненты он в
    // сборку попасть не может, и фильтр выбросил бы его целиком.
    const strings = provider('@feugene/granularity-strings', { i18n: { locales: ['en'] } })
    const manifest = getGranularI18nManifest(
      {
        providers: [strings, core, chrono],
        components: [{ provider: '@feugene/granularity', names: ['GrButton'] }],
      },
      { onlySelected: true },
    )

    expect(manifest.entries.map(e => e.providerId)).toEqual([
      '@feugene/granularity-strings',
      '@feugene/granularity',
    ])
  })

  it('по умолчанию берёт и невыбранных: строки нужны не только компонентам', () => {
    const manifest = getGranularI18nManifest({
      providers: [core, chrono],
      components: [{ provider: '@feugene/granularity', names: ['GrButton'] }],
    })

    expect(manifest.entries).toHaveLength(2)
  })

  it('локали в объединении без повторов', () => {
    const manifest = getGranularI18nManifest({ providers: [core, chrono], components: 'all' })

    expect(manifest.locales).toEqual([...new Set(manifest.locales)])
  })
})

describe('ловушка с аннотацией возвращаемого типа', () => {
  /**
   * Все семь фабрик кольца объявлены как `(): GranularProvider`, и такая
   * аннотация стирает поля, которых нет в базовом интерфейсе. Именно поэтому
   * `i18n` объявлен в самом `GranularProvider`, а не подмешивается сбоку:
   * иначе вклад молча исчезал бы на границе пакетов, а манифест оказывался
   * пустым без единой ошибки.
   */
  function annotatedFactory(): GranularProvider {
    return defineGranularProvider({
      id: 'annotated',
      contractVersion: 1,
      packageBaseUrl: 'file:///annotated/dist/',
      components: [],
      i18n: { locales: ['en'] },
    })
  }

  it('вклад переживает аннотацию', () => {
    const manifest = getGranularI18nManifest({ providers: [annotatedFactory()], components: 'all' })

    expect(manifest.entries).toHaveLength(1)
    expect(manifest.entries[0].entry).toBe('annotated/i18n')
  })
})

describe('плагин виртуального модуля', () => {
  it('резолвит только свой id', () => {
    const plugin = granularI18nPlugin({ providers: [core], components: 'all' })

    expect(plugin.resolveId(GRANULAR_I18N_MODULE_ID)).toBe(`\0${GRANULAR_I18N_MODULE_ID}`)
    expect(plugin.resolveId('virtual:granular-themes')).toBeUndefined()
  })

  it('отдаёт манифест default-экспортом', () => {
    const plugin = granularI18nPlugin({ providers: [core], components: 'all' })
    const source = plugin.load(`\0${GRANULAR_I18N_MODULE_ID}`)

    expect(source).toContain('export default')
    expect(source).toContain('@feugene/granularity/i18n')
    expect(plugin.load('\0virtual:other')).toBeUndefined()
  })
})
