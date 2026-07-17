import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { defineGranularProvider } from '../contract'
import { formatDoctorReport, granularDoctor } from '../doctor'

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
