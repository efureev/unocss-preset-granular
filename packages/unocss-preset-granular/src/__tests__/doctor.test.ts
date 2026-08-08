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
    expect(text).toContain('Провайдеры (1):')
    expect(text).toContain('s:X')
    expect(text).toContain('light → :root (1 токен(ов))')
    // s:X отсутствует на диске → нарушение
    expect(text).toContain('✗ Найдены нарушения layout-контракта')
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
    expect(text).toContain('✓ OK — нарушений layout-контракта не найдено.')
    expect(text).not.toContain('Итоги диагностики')
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

    expect(text).toContain('Итоги диагностики (ошибок: 0, предупреждений: 2):')
    expect(text).toContain('[theme-warning]')
    expect(text).toContain('падают только с --strict')
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
    expect(text).toContain('defaultThemes провайдеров')
    expect(text).toContain('не поставляет её')
  })
})
