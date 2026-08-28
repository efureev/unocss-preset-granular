import type { GranularProvider } from '../contract'
import type { PresetGranularNodeOptions } from '../preset.node'

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { formatTokensReport, granularTokens } from '../tokens'

let root: string
let baseUrl: string

/**
 * Провайдер с графом `Card → Base`. `Base` объявляет и потребляет свой токен,
 * `Card` потребляет провайдерский и один ничей.
 */
function provider(): GranularProvider {
  return {
    id: 'pkg',
    contractVersion: 1,
    packageBaseUrl: baseUrl,
    components: [
      {
        name: 'Base',
        tokenDefinitions: { light: { selector: ':root', tokens: { 'base-c': '#000' } } },
      },
      {
        name: 'Card',
        dependencies: ['Base'],
        safelist: ['border-[var(--shared)]', 'p-[var(--nobody)]'],
      },
      { name: 'Orphan' },
    ],
    theme: { tokenDefinitions: { light: { selector: ':root', tokens: { shared: '#eee' } } } },
  }
}

function options(overrides: PresetGranularNodeOptions['themes'] = { names: ['light'] }): PresetGranularNodeOptions {
  return { providers: [provider()], components: ['pkg:Card'], themes: overrides }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'granular-tokens-'))
  baseUrl = pathToFileURL(`${root}/`).href
  for (const name of ['Base', 'Card', 'Orphan']) {
    const dir = join(root, 'components', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.js'), 'export default 1\n', 'utf8')
  }
  writeFileSync(join(root, 'components', 'Base', 'b.js'), 'export const c = "bg-[var(--base-c)]"\n', 'utf8')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('granularTokens: происхождение', () => {
  it('разделяет провайдерский (общий) токен и ничей', () => {
    const report = granularTokens(options(), 'pkg:Card')

    const shared = report.uses.find(u => u.token === 'shared')!
    expect(shared.origin).toBe('provider')
    expect(shared.declaredBy).toBe('provider:pkg')
    expect(shared.values[0].effective).toBe('#eee')

    const nobody = report.uses.find(u => u.token === 'nobody')!
    expect(nobody.origin).toBe('none')
    expect(nobody.values).toEqual([])
    expect(report.undefinedCount).toBe(1)
  })

  it('токен, объявленный самим компонентом, получает origin own', () => {
    const report = granularTokens({ ...options(), components: ['pkg:Base'] }, 'pkg:Base')
    const own = report.uses.find(u => u.token === 'base-c')!
    expect(own.origin).toBe('own')
    expect(own.declaredBy).toBe('pkg:Base')
  })

  it('app-override поднимает origin до app и виден в цепочке', () => {
    const report = granularTokens(
      options({ names: ['light'], tokenOverrides: { light: { shared: '#f00' } } }),
      'pkg:Card',
    )
    const shared = report.uses.find(u => u.token === 'shared')!
    expect(shared.values[0].layers.map(l => l.source)).toEqual(['provider:pkg', 'app-override'])
    expect(shared.values[0].effective).toBe('#f00')
    // Нижний слой остаётся провайдерским — токен всё ещё «общий», а не app.
    expect(shared.origin).toBe('provider')
  })
})

describe('granularTokens: scope и разделяемость', () => {
  it('own не видит токены зависимости, deep видит', () => {
    expect(granularTokens(options(), 'pkg:Card').uses.some(u => u.token === 'base-c')).toBe(false)

    const deep = granularTokens(options(), 'pkg:Card', 'deep')
    const inherited = deep.uses.find(u => u.token === 'base-c')!
    expect(inherited.usedBy).toEqual(['pkg:Base'])
    // Для цели это токен ДРУГОГО компонента — ровно то, что подсвечивает --deep.
    expect(inherited.origin).toBe('component')
    expect(deep.components).toEqual(['pkg:Base', 'pkg:Card'])
  })

  it('deep включает объявления под-компонентов с указанием владельца', () => {
    const deep = granularTokens(options(), 'pkg:Card', 'deep')
    const declaration = deep.declares.find(d => d.token === 'base-c')!
    expect(declaration.declaredBy).toBe('pkg:Base')
    expect(declaration.value).toBe('#000')
  })

  it('alsoUsedBy показывает потребителей вне scope', () => {
    const report = granularTokens({ ...options(), components: 'all' }, 'pkg:Base')
    const base = report.uses.find(u => u.token === 'base-c')!
    expect(base.alsoUsedBy).toEqual([])
    // `shared` потребляет Card, который вне scope этого отчёта.
    expect(report.uses.find(u => u.token === 'shared')).toBeUndefined()
  })
})

describe('granularTokens: неизвестное имя', () => {
  it('незнакомый компонент даёт available и пустой отчёт', () => {
    const report = granularTokens(options(), 'pkg:Nope')
    expect(report.available).toContain('pkg:Card')
    expect(report.uses).toEqual([])
  })

  it('короткая форма имени резолвится, если однозначна', () => {
    expect(granularTokens(options(), 'Card').key).toBe('pkg:Card')
  })
})

describe('granularTokens: регрессии code-review', () => {
  it('одноимённый компонент другого провайдера не считается своим', () => {
    // `source` слоя — это `component:<Name>`, а имена уникальны лишь внутри
    // провайдера. Склейка ключа из providerId читателя приписывала чужое
    // объявление цели — с вердиктом `own`.
    const donor: GranularProvider = {
      id: 'other',
      contractVersion: 1,
      packageBaseUrl: baseUrl,
      components: [{
        name: 'Card',
        // Объявляет ровно тот токен, который потребляет `pkg:Card`.
        tokenDefinitions: { light: { selector: ':root', tokens: { nobody: '#111' } } },
      }],
    }
    const report = granularTokens(
      { providers: [provider(), donor], components: 'all', themes: { names: ['light'] } },
      'pkg:Card',
    )

    const found = report.uses.find(u => u.token === 'nobody')!
    // До фикса ключ собирался как `<providerId цели>:<имя из source>` и давал
    // `pkg:Card` — то есть чужое объявление приписывалось цели как своё.
    expect(found.origin).toBe('component')
    expect(found.declaredBy).toBe('other:Card')
  })

  it('токен из одних лишь отброшенных strictTokens слоёв — origin none', () => {
    // Иначе `granular tokens` называл бы его пришедшим от приложения, а
    // `doctor` — неопределённым: два ответа про один токен.
    const report = granularTokens(
      options({ names: ['light'], strictTokens: true, tokenOverrides: { light: { nobody: 'red' } } }),
      'pkg:Card',
    )
    const nobody = report.uses.find(u => u.token === 'nobody')!

    expect(nobody.origin).toBe('none')
    expect(report.undefinedCount).toBe(1)
    expect(nobody.values[0].effective).toBeUndefined()
  })
})

describe('formatTokensReport', () => {
  it('группирует по происхождению и печатает оговорку про открытость', () => {
    const text = formatTokensReport(granularTokens(options(), 'pkg:Card'), root)

    expect(text).toContain('from the provider — design-system tokens (1):')
    expect(text).toContain('not defined by any granular layer (1):')
    expect(text).toContain('⚠ --nobody')
    expect(text).toContain('granular does not track those.')
  })

  it('без неопределённых токенов оговорка не печатается', () => {
    const text = formatTokensReport(granularTokens({ ...options(), components: ['pkg:Base'] }, 'pkg:Base'), root)
    expect(text).not.toContain('granular does not track those.')
  })

  it('неизвестное имя печатает список известных', () => {
    const text = formatTokensReport(granularTokens(options(), 'pkg:Nope'), root)
    expect(text).toContain('no provider declares such a component')
    expect(text).toContain('• pkg:Card')
  })
})
