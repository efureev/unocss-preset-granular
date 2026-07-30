import type { GranularProvider } from '../contract'
import type { PresetGranularNodeOptions } from '../preset.node'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { formatWhyCssReport, granularWhyCss } from '../why-css'

let root: string
let baseUrl: string

/**
 * Один компонент, покрывающий все три канала попадания класса в CSS:
 * `safelist`, селектор в CSS-файле и класс в исходнике под сканом.
 */
function options(): PresetGranularNodeOptions {
  const provider: GranularProvider = {
    id: 'pkg',
    contractVersion: 1,
    packageBaseUrl: baseUrl,
    components: [{
      name: 'Btn',
      safelist: ['btn-safe'],
      cssFiles: [new URL('btn.css', baseUrl).href],
    }],
  }
  return { providers: [provider], components: 'all' }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'granular-why-'))
  const dir = join(root, 'components', 'Btn')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'index.js'),
    'export const cls = "text-red-500 p-2"\n',
    'utf8',
  )
  writeFileSync(join(dir, 'notes.md'), 'md-only-class\n', 'utf8')
  writeFileSync(
    join(root, 'btn.css'),
    '.btn-root { color: red }\n.hover\\:bg-red:hover { color: blue }\n',
    'utf8',
  )
  baseUrl = pathToFileURL(`${root}/`).href
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('granularWhyCss: каналы попадания класса в CSS', () => {
  it('класс из safelist', async () => {
    const report = await granularWhyCss(options(), 'btn-safe')

    expect(report.found).toBe(true)
    expect(report.hits).toEqual([
      { via: 'safelist', providerId: 'pkg', componentName: 'Btn' },
    ])
  })

  it('селектор в CSS-файле компонента', async () => {
    const report = await granularWhyCss(options(), 'btn-root')

    expect(report.hits.map(h => h.via)).toEqual(['component-css'])
    expect(report.hits[0].file).toContain('btn.css')
  })

  it('экранированный селектор в CSS находится по исходному имени класса', async () => {
    const report = await granularWhyCss(options(), 'hover:bg-red')

    expect(report.hits.map(h => h.via)).toEqual(['component-css'])
  })

  it('класс в исходнике компонента', async () => {
    const report = await granularWhyCss(options(), 'text-red-500')

    expect(report.hits.map(h => h.via)).toEqual(['source-scan'])
    expect(report.hits[0].file).toContain('index.js')
    expect(report.scanned.dirs).toBe(1)
  })

  it('совпадение только по границам: `p` не находится внутри `p-2`', async () => {
    expect((await granularWhyCss(options(), 'p')).found).toBe(false)
  })

  it('файл с расширением вне скана не просматривается', async () => {
    expect((await granularWhyCss(options(), 'md-only-class')).found).toBe(false)
  })

  it('расширение из scan.extensions добавляет файл к просмотру', async () => {
    const report = await granularWhyCss(
      { ...options(), scan: { extensions: ['md'] } },
      'md-only-class',
    )

    expect(report.hits.map(h => h.via)).toEqual(['source-scan'])
  })

  it('класса нет нигде — found: false, но охват посчитан', async () => {
    const report = await granularWhyCss(options(), 'nowhere-at-all')

    expect(report.found).toBe(false)
    expect(report.scanned.cssFiles).toBe(1)
    expect(report.scanned.sourceFiles).toBe(1)
  })

  it('нечитаемый CSS-файл не роняет команду', async () => {
    const provider: GranularProvider = {
      id: 'pkg',
      contractVersion: 1,
      packageBaseUrl: baseUrl,
      components: [{ name: 'Btn', cssFiles: [new URL('missing.css', baseUrl).href] }],
    }
    const report = await granularWhyCss({ providers: [provider], components: 'all' }, 'btn-root')

    expect(report.found).toBe(false)
  })
})

describe('formatWhyCssReport', () => {
  it('группирует источники по каналу и режет пути до относительных', async () => {
    const report = await granularWhyCss(options(), 'text-red-500')
    const text = formatWhyCssReport(report, root)

    expect(text).toContain('granular why-css text-red-500')
    expect(text).toContain('исходник компонента')
    expect(text).toContain('components/Btn/index.js')
  })

  it('при отсутствии источников подсказывает про rules и темы', async () => {
    const text = formatWhyCssReport(await granularWhyCss(options(), 'nope'), root)

    expect(text).toContain('Источников не найдено')
    expect(text).toContain('rules/shortcuts')
  })
})
