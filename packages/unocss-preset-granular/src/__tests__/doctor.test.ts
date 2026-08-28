import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { defineGranularProvider } from '../contract'
import { countDoctorDiagnostics, formatDoctorReport, granularDoctor } from '../doctor'

describe('granularDoctor', () => {
  it('репортит провайдеров, транзитивный граф и порядок компонентов', () => {
    const donor = defineGranularProvider({
      id: 'donor',
      contractVersion: 1,
      packageBaseUrl: 'file:///donor/',
      components: [{ name: 'Base', safelist: ['b-1', 'b-2'] }],
    })
    const app = defineGranularProvider({
      id: 'app',
      contractVersion: 1,
      packageBaseUrl: 'file:///app/',
      components: [{ name: 'Card', safelist: [], cssFiles: [], dependencies: ['donor:Base'] }],
      dependencies: [donor],
    })

    const report = granularDoctor({ providers: [app], components: ['app:Card'] })

    expect(report.providers.map(p => p.id)).toEqual(['donor', 'app'])
    // порядок компонентов: зависимость раньше зависящего
    expect(report.components.map(c => c.key)).toEqual(['donor:Base', 'app:Card'])
    const card = report.components.find(c => c.key === 'app:Card')!
    expect(card.dependencies).toEqual(['donor:Base'])
    const base = report.components.find(c => c.key === 'donor:Base')!
    expect(base.safelist).toBe(2)
  })

  it('находит конфликты токенов между провайдером, компонентом и override', () => {
    const provider = defineGranularProvider({
      id: 's',
      contractVersion: 1,
      packageBaseUrl: 'file:///s/',
      components: [{
        name: 'X',
        safelist: [],
        tokenDefinitions: { light: { tokens: { primary: 'green' } } },
      }],
      theme: { tokenDefinitions: { light: { selector: ':root', tokens: { primary: 'blue', accent: 'purple' } } } },
    })

    const report = granularDoctor({
      providers: [provider],
      components: 'all',
      themes: { names: ['light'], tokenOverrides: { light: { primary: 'red' } } },
    })

    const primary = report.tokenConflicts.find(t => t.token === 'primary')
    expect(primary).toBeDefined()
    expect(primary!.sources).toEqual(['provider:s', 'component:X', 'app-override'])
    expect(primary!.finalValue).toBe('red')
    // accent задан только провайдером — не конфликт
    expect(report.tokenConflicts.some(t => t.token === 'accent')).toBe(false)
  })

  it('находит токены, объявленные с префиксом `--` (token-prefix)', () => {
    const provider = defineGranularProvider({
      id: 'dash',
      contractVersion: 1,
      packageBaseUrl: 'file:///dash/',
      components: [],
      theme: {
        // '--brand' — ловушка: в CSS уедет `----brand`. 'ok' — корректный ключ.
        tokenDefinitions: { light: { selector: ':root', tokens: { '--brand': '#f00', 'ok': '#0f0' } } },
      },
    })

    const report = granularDoctor({
      providers: [provider],
      components: 'all',
      themes: { names: ['light'], tokenOverrides: { light: { '--extra': '1px' } } },
    })

    const dash = report.diagnostics.filter(d => d.code === 'token-prefix')
    expect(dash.map(d => d.subject).sort()).toEqual(['light:--brand', 'light:--extra'])
    expect(dash.every(d => d.level === 'warn')).toBe(true)
    // Сборка формально живая (это не layout-нарушение): ok остаётся true,
    // а вот clean — нет; под --strict такое падает.
    expect(report.ok).toBe(true)
    expect(report.clean).toBe(false)
    // Корректный ключ диагностику не порождает.
    expect(dash.some(d => d.subject.includes(':ok'))).toBe(false)
  })

  it('репортит скан-globs и отсутствующие директории компонентов (missing)', () => {
    // Реальная директория провайдера: одна компонента есть с index.js, другой нет.
    const root = mkdtempSync(join(tmpdir(), 'granular-doctor-'))
    mkdirSync(join(root, 'components', 'Present'), { recursive: true })
    writeFileSync(join(root, 'components', 'Present', 'index.js'), 'export default {}\n')

    const baseUrl = `${pathToFileURL(root).href}/`
    const provider = defineGranularProvider({
      id: 'p',
      contractVersion: 1,
      packageBaseUrl: baseUrl,
      components: [
        { name: 'Present', safelist: [] },
        { name: 'Absent', safelist: [] },
      ],
    })

    const report = granularDoctor({ providers: [provider], components: 'all' })

    expect(report.scan.globs.some(g => g.includes('/components/Present/'))).toBe(true)
    expect(report.scan.missing).toHaveLength(1)
    expect(report.scan.missing[0]).toMatchObject({ componentName: 'Absent', reason: 'missing-dir' })
    expect(report.ok).toBe(false)
  })

  it('ok=true, когда нарушений layout нет (data-URL cssFiles, но dir не требуется в strict)', () => {
    // Провайдер с несуществующей packageBaseUrl → missing, ok=false.
    const provider = defineGranularProvider({
      id: 'n',
      contractVersion: 1,
      packageBaseUrl: 'file:///definitely/not/here/',
      components: [{ name: 'A', safelist: [] }],
    })
    const report = granularDoctor({ providers: [provider], components: 'all' })
    expect(report.ok).toBe(false)
    expect(report.scan.missing[0].reason).toBe('missing-dir')
  })
})

describe('formatDoctorReport', () => {
  it('рендерит секции и финальный статус', () => {
    const provider = defineGranularProvider({
      id: 's',
      contractVersion: 1,
      packageBaseUrl: 'file:///s/',
      components: [{ name: 'X', safelist: ['x-1'] }],
      theme: { tokenDefinitions: { light: { selector: ':root', tokens: { primary: 'blue' } } } },
    })
    const report = granularDoctor({ providers: [provider], components: 'all', themes: { names: ['light'] } })
    const text = formatDoctorReport(report)

    expect(text).toContain('granular doctor')
    expect(text).toContain('Providers (1):')
    expect(text).toContain('s:X')
    expect(text).toContain('light → :root (1 token(s))')
    // s:X отсутствует на диске → нарушение
    expect(text).toContain('✗ Layout-contract violations found')
  })
})

describe('doctor: уровни диагностики', () => {
  it('нарушение layout-контракта — error: ok=false и clean=false', () => {
    const provider = defineGranularProvider({
      id: 'n',
      contractVersion: 1,
      packageBaseUrl: 'file:///definitely/not/here/',
      components: [{ name: 'A', safelist: [] }],
    })

    const report = granularDoctor({ providers: [provider], components: 'all' })

    expect(report.diagnostics).toEqual([
      expect.objectContaining({ level: 'error', code: 'layout-contract', subject: 'n:A' }),
    ])
    expect(report.ok).toBe(false)
    expect(report.clean).toBe(false)
    expect(countDoctorDiagnostics(report)).toEqual({ errors: 1, warnings: 0 })
  })

  it('конфликт токенов и предупреждение тем — warn: ok=true, clean=false', () => {
    const provider = defineGranularProvider({
      id: 's',
      contractVersion: 1,
      packageBaseUrl: 'file:///s/',
      components: [],
      theme: {
        defaultThemes: ['light'],
        tokenDefinitions: { light: { selector: ':root', tokens: { primary: 'blue' } } },
      },
    })

    const report = granularDoctor({
      providers: [provider],
      scan: { enabled: false },
      themes: { tokenOverrides: { light: { primary: 'red' } } },
    })

    expect(report.diagnostics.map(d => d.code)).toEqual(['token-conflict'])
    expect(report.diagnostics[0]).toMatchObject({ level: 'warn', subject: 'light:primary' })
    expect(report.ok).toBe(true)
    expect(report.clean).toBe(false)
  })

  it('провайдер без вклада — warn unused-provider', () => {
    const useful = defineGranularProvider({
      id: 'useful',
      contractVersion: 1,
      packageBaseUrl: 'file:///useful/',
      components: [{ name: 'X', safelist: ['x'] }],
    })
    const idle = defineGranularProvider({
      id: 'idle',
      contractVersion: 1,
      packageBaseUrl: 'file:///idle/',
      components: [],
    })

    const report = granularDoctor({
      providers: [useful, idle],
      components: ['useful:X'],
      scan: { enabled: false },
    })

    expect(report.diagnostics).toEqual([
      expect.objectContaining({ level: 'warn', code: 'unused-provider', subject: 'idle' }),
    ])
  })

  it('провайдер без выбранных компонентов, но с unocss-вкладом, — не предупреждение', () => {
    const rulesOnly = defineGranularProvider({
      id: 'rules',
      contractVersion: 1,
      packageBaseUrl: 'file:///rules/',
      components: [],
      unocss: { rules: [[/^x-(\d+)$/, ([, d]) => ({ width: `${d}px` })]] },
    })

    const report = granularDoctor({ providers: [rulesOnly], scan: { enabled: false } })

    expect(report.diagnostics).toEqual([])
    expect(report.clean).toBe(true)
  })

  it('чистый конфиг — пустая диагностика и обычный статус в тексте', () => {
    const provider = defineGranularProvider({
      id: 'p',
      contractVersion: 1,
      packageBaseUrl: 'file:///p/',
      components: [{ name: 'X', safelist: ['x'] }],
    })

    const report = granularDoctor({ providers: [provider], components: 'all', scan: { enabled: false } })
    const text = formatDoctorReport(report)

    expect(report.clean).toBe(true)
    expect(text).toContain('✓ OK — no layout-contract violations.')
    expect(text).not.toContain('Diagnostics summary')
  })

  it('текстовый отчёт со сводкой упоминает --strict', () => {
    const provider = defineGranularProvider({
      id: 'p',
      contractVersion: 1,
      packageBaseUrl: 'file:///p/',
      components: [],
      theme: { defaultThemes: ['day', 'night'], themes: { day: 'file:///p/day.css' } },
    })

    const text = formatDoctorReport(granularDoctor({ providers: [provider], scan: { enabled: false } }))

    expect(text).toContain('Diagnostics summary (errors: 0, warnings: 2):')
    expect(text).toContain('[theme-warning]')
    expect(text).toContain('they only fail with --strict')
  })
})

describe('doctor: token-undefined', () => {
  const root = mkdtempSync(join(tmpdir(), 'granular-doctor-undef-'))
  const baseUrl = pathToFileURL(`${root}/`).href

  for (const name of ['A']) {
    mkdirSync(join(root, 'components', name), { recursive: true })
    writeFileSync(join(root, 'components', name, 'index.js'), 'export default 1\n', 'utf8')
  }
  writeFileSync(join(root, 'tokens.css'), ':root { --from-css: 1px }\n', 'utf8')

  function optionsWith(theme?: Record<string, unknown>) {
    return {
      providers: [{
        id: 'pkg',
        contractVersion: 1 as const,
        packageBaseUrl: baseUrl,
        components: [{
          name: 'A',
          safelist: ['p-[var(--nobody)]', 'm-[var(--from-css)]', 'g-[var(--with-fb,2px)]'],
        }],
        ...(theme ? { theme } : {}),
      }],
      components: 'all' as const,
    }
  }

  it('находит токен, которого не задаёт ни один слой', () => {
    const report = granularDoctor(optionsWith())
    expect(report.undefinedTokens.map(t => t.token)).toContain('nobody')
    expect(report.diagnostics.some(d => d.code === 'token-undefined')).toBe(true)
  })

  it('меняет clean, но не ok', () => {
    const report = granularDoctor(optionsWith())
    expect(report.ok).toBe(true)
    expect(report.clean).toBe(false)
  })

  it('токены из инлайнимого tokens.css не считаются неопределёнными', () => {
    // Иначе диагностика ругалась бы на собственный CSS granular.
    const report = granularDoctor(optionsWith({ tokensCssUrl: new URL('tokens.css', baseUrl).href }))
    expect(report.undefinedTokens.map(t => t.token)).not.toContain('from-css')
  })

  it('fallback в var(--x, …) отмечается и НЕ даёт диагностики', () => {
    // `var(--x, 8px)` рисует корректно без единого слоя, поэтому дефектом не
    // является. Запись в отчёте остаётся, диагностика — нет: иначе
    // `doctor --strict` краснел бы в CI на исправном коде.
    const report = granularDoctor(optionsWith())
    expect(report.undefinedTokens.find(t => t.token === 'with-fb')!.hasFallback).toBe(true)
    expect(report.diagnostics.some(d => d.subject.endsWith(':with-fb'))).toBe(false)
  })

  it('токены из подменённого themeFiles не считаются неопределёнными', () => {
    // `themes.themeFiles` решает, какой файл темы реально уедет в CSS.
    // Без его учёта доктор разбирал бы провайдерский оригинал, а ругался на
    // подменённый — красный CI на верной конфигурации.
    const report = granularDoctor({
      ...optionsWith({ themes: { light: new URL('provider-light.css', baseUrl).href } }),
      themes: { names: ['light'], themeFiles: { light: new URL('tokens.css', baseUrl).href } },
    })
    expect(report.undefinedTokens.map(t => t.token)).not.toContain('from-css')
  })

  it('подмена tokensFile ВЫТЕСНЯЕТ провайдерский файл — токен становится неопределённым', () => {
    // Главный баг 0.14.x: эмиссия заменяет провайдерский `tokens.css`, а
    // диагностика складывала оба файла в одно множество «заданного». Токен,
    // который приложение снесло подменой, оставался для неё заданным — и она
    // молчала ровно в том случае, ради которого заведена.
    const report = granularDoctor({
      ...optionsWith({ tokensCssUrl: new URL('tokens.css', baseUrl).href }),
      themes: { tokensFile: `data:text/css,${encodeURIComponent(':root{--other:1}')}` },
    })

    expect(report.undefinedTokens.map(t => t.token)).toContain('from-css')
  })

  it('пообъектная подмена вытесняет только своего провайдера', () => {
    const report = granularDoctor({
      ...optionsWith({ tokensCssUrl: new URL('tokens.css', baseUrl).href }),
      themes: { tokensFile: { other: `data:text/css,${encodeURIComponent(':root{--x:1}')}` } },
    })
    // `pkg` в объекте нет — его файл остаётся, токен по-прежнему задан.
    expect(report.undefinedTokens.map(t => t.token)).not.toContain('from-css')
  })

  it('структурная тема вытесняет файловую: файл темы не читается', () => {
    // `resolveThemes` разводит их через `else if`, и файл в CSS не уезжает.
    // Доктор, читавший `theme.themes[name]` напрямую, добавлял его токены в
    // «заданные» — ложноотрицательные находки на ровном месте.
    const report = granularDoctor({
      ...optionsWith({
        themes: { light: new URL('tokens.css', baseUrl).href },
        tokenDefinitions: { light: { selector: ':root', tokens: { structural: '1px' } } },
      }),
      themes: { names: ['light'] },
    })

    expect(report.undefinedTokens.map(t => t.token)).toContain('from-css')
  })

  it('токен, заданный через tokenOverrides, неопределённым не считается', () => {
    const report = granularDoctor({
      ...optionsWith(),
      themes: { names: ['light'], tokenOverrides: { light: { nobody: '#000' } } },
    })
    expect(report.undefinedTokens.map(t => t.token)).not.toContain('nobody')
  })
})

describe('doctor: конфликты токенов и strictTokens', () => {
  const provider = defineGranularProvider({
    id: 'p',
    contractVersion: 1,
    packageBaseUrl: 'file:///p/',
    components: [],
    theme: { tokenDefinitions: { light: { selector: ':root', tokens: { brd: '#aaa' } } } },
  })

  it('override, отброшенный strictTokens, конфликта не создаёт', () => {
    // Регрессия: конфликт считался по числу НАПИСАННЫХ слоёв, а генератор CSS
    // отбрасывает override неизвестного токена. Отчёт называл финальным
    // значение, которого в CSS нет.
    const report = granularDoctor({
      providers: [provider],
      components: 'all',
      themes: {
        names: ['light'],
        strictTokens: true,
        // Обе формы целятся в один ключ карты — два слоя на `nope`.
        tokenOverrides: { light: { 'nope': '#111', ':root': { nope: '#222' } } },
      },
    })

    expect(report.tokenConflicts.filter(c => c.token === 'nope')).toEqual([])
  })

  it('без strictTokens те же два слоя дают конфликт с реальным значением', () => {
    const report = granularDoctor({
      providers: [provider],
      components: 'all',
      themes: {
        names: ['light'],
        tokenOverrides: { light: { 'nope': '#111', ':root': { nope: '#222' } } },
      },
    })

    const conflict = report.tokenConflicts.find(c => c.token === 'nope')!
    expect(conflict.sources).toEqual(['app-override', 'app-override'])
    expect(conflict.finalValue).toBe('#222')
  })
})

describe('doctor: темы по умолчанию', () => {
  it('показывает источник имён и предупреждения', () => {
    const provider = defineGranularProvider({
      id: 'p',
      contractVersion: 1,
      packageBaseUrl: 'file:///p/',
      components: [],
      theme: {
        defaultThemes: ['brand-day', 'brand-night'],
        themes: { 'brand-day': 'file:///p/day.css' },
      },
    })

    const report = granularDoctor({ providers: [provider], scan: { enabled: false } })

    expect(report.themes.names).toEqual(['brand-day', 'brand-night'])
    expect(report.themes.namesSource).toBe('provider-defaults')
    expect(report.themes.warnings.map(w => w.kind)).toEqual([
      'default-theme-without-source',
      'multiple-default-themes',
    ])

    const text = formatDoctorReport(report)
    expect(text).toContain('providers\' defaultThemes')
    expect(text).toContain('does not supply it')
  })
})
