import type { PresetGranularNodeOptions } from '../preset.node'

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { defineGranularComponent, defineGranularProvider } from '../contract'
import { granularDoctor } from '../doctor'
import { granularContent, inspectGranularScanDirs } from '../preset.node'

let root: string
let options: PresetGranularNodeOptions

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'granular-inspect-'))
  const pkg = join(root, 'pkg/dist')

  // Ok — директория с index.js.
  const ok = join(pkg, 'components/Ok')
  mkdirSync(ok, { recursive: true })
  writeFileSync(join(ok, 'index.js'), '', 'utf8')

  // NoEntry — директория есть, а index.js нет: по контракту компонент
  // в скан НЕ идёт (его чанк не был собран).
  const noEntry = join(pkg, 'components/NoEntry')
  mkdirSync(noEntry, { recursive: true })

  const mk = (name: string, dir: string) =>
    defineGranularComponent(pathToFileURL(join(dir, 'config.ts')).href, { name, safelist: [] })

  const provider = defineGranularProvider({
    id: 'pkg',
    contractVersion: 1,
    packageBaseUrl: pathToFileURL(`${pkg}/`).href,
    components: [mk('Ok', ok), mk('NoEntry', noEntry)],
  })

  options = { providers: [provider], components: 'all' }
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('мемоизация инспекции скан-директорий (AUDIT D1)', () => {
  it('обход FS выполняется один раз на объект опций', () => {
    const opts: PresetGranularNodeOptions = { ...options }

    const first = inspectGranularScanDirs(opts)
    const second = inspectGranularScanDirs(opts)
    // Те же самые объекты, а не эквивалентные копии.
    expect(second).toBe(first)
    expect(second.dirs).toBe(first.dirs)

    // Потребители из разных мест берут тот же результат.
    granularContent(opts)
    expect(inspectGranularScanDirs(opts)).toBe(first)
  })

  it('другой объект опций считается заново', () => {
    expect(inspectGranularScanDirs({ ...options })).not.toBe(inspectGranularScanDirs({ ...options }))
  })

  it('предупреждение о нарушении контракта печатается один раз на объект опций', () => {
    const opts: PresetGranularNodeOptions = { ...options }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    inspectGranularScanDirs(opts)
    granularContent(opts)
    granularDoctor(opts)

    expect(warn.mock.calls.filter(c => String(c[0]).includes('NoEntry'))).toHaveLength(1)
    warn.mockRestore()
  })
})

describe('doctor и content.filesystem считают одно и то же (AUDIT C5)', () => {
  it('doctor показывает ровно те директории, что уходят в скан', () => {
    const opts: PresetGranularNodeOptions = { ...options }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const report = granularDoctor(opts)
    const scanned = inspectGranularScanDirs(opts).dirs.map(d => d.dir)

    expect(report.scan.dirs.map(d => d.dir)).toEqual(scanned)

    // Компонент без index.js не попадает в dirs НИ там, ни там — раньше
    // doctor показывал его как сканируемый, хотя резолвер его пропускал.
    expect(report.scan.dirs.some(d => d.componentName === 'NoEntry')).toBe(false)
    expect(report.scan.missing.map(m => [m.componentName, m.reason]))
      .toEqual([['NoEntry', 'missing-entry']])
    expect(report.ok).toBe(false)

    warn.mockRestore()
  })

  it('глобы doctor построены из того же набора директорий', () => {
    const opts: PresetGranularNodeOptions = { ...options }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const report = granularDoctor(opts)
    for (const dir of report.scan.dirs)
      expect(report.scan.globs.some(g => g.startsWith(dir.dir))).toBe(true)
    expect(report.scan.globs).toHaveLength(report.scan.dirs.length)

    warn.mockRestore()
  })
})
