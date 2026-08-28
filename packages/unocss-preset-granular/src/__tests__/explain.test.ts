import type { GranularProvider } from '../contract'
import type { PresetGranularNodeOptions } from '../preset.node'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { formatExplainReport, granularExplain } from '../explain'

let root: string
let baseUrl: string

/**
 * Провайдер с графом `Card → Base`, собственными токенами у обоих и одним
 * компонентом вне селекции. Директории компонентов реальные — иначе
 * layout-контракт отсеет их из скана и `scanDirs` в отчёте будет пуст.
 */
function provider(): GranularProvider {
  return {
    id: 'pkg',
    contractVersion: 1,
    packageBaseUrl: baseUrl,
    components: [
      {
        name: 'Base',
        safelist: ['base-cls'],
        tokenDefinitions: { light: { tokens: { 'x-color': '#000' } } },
      },
      {
        name: 'Card',
        dependencies: ['Base'],
        safelist: ['card-cls'],
        group: 'cards',
        cssFiles: [new URL('card.css', baseUrl).href],
        cssFileAssetNames: ['card.css'],
        // Компонент-потребитель перебивает токен зависимости.
        tokenDefinitions: { light: { tokens: { 'x-color': '#fff' } } },
      },
      { name: 'Orphan' },
    ],
  }
}

function options(): PresetGranularNodeOptions {
  return {
    providers: [provider()],
    components: ['pkg:Card'],
  }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'granular-explain-'))
  for (const name of ['Base', 'Card', 'Orphan']) {
    const dir = join(root, 'components', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.js'), `export const ${name} = 1\n`, 'utf8')
  }
  writeFileSync(join(root, 'card.css'), '.card-root { color: red }\n', 'utf8')
  baseUrl = pathToFileURL(`${root}/`).href
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('granularExplain: почему компонент в сборке', () => {
  it('корень селекции помечен как selected, цепочка — он сам', () => {
    const report = granularExplain(options(), 'pkg:Card')

    expect(report.included).toBe(true)
    expect(report.reason).toBe('selected')
    expect(report.chain).toEqual(['pkg:Card'])
    expect(report.dependencies).toEqual(['pkg:Base'])
    expect(report.requiredBy).toEqual([])
    expect(report.group).toBe('cards')
  })

  it('транзитивная зависимость — цепочка от корня и обратные ссылки', () => {
    const report = granularExplain(options(), 'pkg:Base')

    expect(report.reason).toBe('dependency')
    expect(report.chain).toEqual(['pkg:Card', 'pkg:Base'])
    expect(report.requiredBy).toEqual(['pkg:Card'])
    expect(report.safelist).toEqual(['base-cls'])
  })

  it('невыбранный компонент — included: false и пустая цепочка', () => {
    const report = granularExplain(options(), 'pkg:Orphan')

    expect(report.included).toBe(false)
    expect(report.reason).toBe('not-selected')
    expect(report.chain).toEqual([])
  })

  it('токен, перебитый компонентом-потребителем, помечен overridden', () => {
    const base = granularExplain(options(), 'pkg:Base')
    expect(base.tokens).toEqual([
      {
        theme: 'light',
        selector: ':root',
        tokens: [{ name: 'x-color', value: '#000', effective: '#fff', overridden: true }],
      },
    ])

    const card = granularExplain(options(), 'pkg:Card')
    expect(card.tokens[0].tokens[0]).toMatchObject({ value: '#fff', overridden: false })
  })

  it('cssFiles показаны вместе с asset-именем', () => {
    const report = granularExplain(options(), 'pkg:Card')

    expect(report.cssFiles).toHaveLength(1)
    expect(report.cssFiles[0].assetName).toBe('card.css')
    expect(report.cssFiles[0].dedupedInto).toBeUndefined()
  })

  it('скан-директория компонента попадает в отчёт', () => {
    const report = granularExplain(options(), 'pkg:Card')

    expect(report.scanDirs).toHaveLength(1)
    expect(report.scanDirs[0].dir).toContain('components')
    expect(report.scanSkipped).toBeUndefined()
  })

  it('короткое имя резолвится, пока оно однозначно', () => {
    expect(granularExplain(options(), 'Card').key).toBe('pkg:Card')
  })

  it('неоднозначное короткое имя — unknown со списком кандидатов', () => {
    const second: GranularProvider = {
      id: 'other',
      contractVersion: 1,
      packageBaseUrl: 'file:///other/',
      components: [{ name: 'Card' }],
    }
    const report = granularExplain(
      { providers: [provider(), second], components: ['pkg:Card'] },
      'Card',
    )

    expect(report.reason).toBe('unknown')
    expect(report.available).toEqual(['pkg:Card', 'other:Card'])
  })

  it('неизвестный компонент известного провайдера — подсказка по провайдеру', () => {
    const report = granularExplain(options(), 'pkg:Nope')

    expect(report.reason).toBe('unknown')
    expect(report.available).toEqual(['pkg:Base', 'pkg:Card', 'pkg:Orphan'])
  })

  it('неизвестный провайдер — подсказка по всему реестру', () => {
    const report = granularExplain(options(), 'nope:Card')

    expect(report.reason).toBe('unknown')
    expect(report.available).toContain('pkg:Card')
  })
})

describe('granularExplain: итоговые значения токенов', () => {
  it('tokenOverrides приложения учитываются в effective/overridden', () => {
    // Регрессия: `effective` считался по `tokenRegistry`, куда
    // `themes.tokenOverrides` не входит — отчёт показывал до-override
    // значение и `overridden: false` там, где токен как раз перебит.
    const report = granularExplain(
      { ...options(), themes: { names: ['light'], tokenOverrides: { light: { 'x-color': '#f00' } } } },
      'pkg:Card',
    )
    const light = report.tokens.find(t => t.theme === 'light')!
    const token = light.tokens.find(t => t.name === 'x-color')!

    expect(token.value).toBe('#fff')
    expect(token.effective).toBe('#f00')
    expect(token.overridden).toBe(true)
  })
})

describe('formatExplainReport', () => {
  it('рендерит цепочку, вклад и скан-директории', () => {
    const text = formatExplainReport(granularExplain(options(), 'pkg:Base'))

    expect(text).toContain('granular explain pkg:Base')
    expect(text).toContain('pkg:Card → pkg:Base')
    expect(text).toContain('safelist (1): base-cls')
    expect(text).toContain('(overridden → #fff)')
  })

  it('для unknown печатает список известных компонентов', () => {
    const text = formatExplainReport(granularExplain(options(), 'pkg:Nope'))

    expect(text).toContain('no provider declares such a component')
    expect(text).toContain('pkg:Card')
  })

  it('нарушение layout-контракта видно в отчёте', () => {
    const broken: GranularProvider = {
      id: 'broken',
      contractVersion: 1,
      packageBaseUrl: pathToFileURL(`${join(root, 'nowhere')}/`).href,
      components: [{ name: 'Ghost' }],
    }
    const report = granularExplain({ providers: [broken], components: 'all' }, 'broken:Ghost')

    expect(report.scanSkipped?.reason).toBe('missing-dir')
    expect(formatExplainReport(report)).toContain('Not scanned')
  })
})
