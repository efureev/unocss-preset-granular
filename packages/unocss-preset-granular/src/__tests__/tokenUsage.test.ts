import type { GranularProvider } from '../contract'
import type { PresetGranularNodeOptions } from '../preset.node'

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { inspectGranularTokenUsage } from '../fs/tokenUsage'
import { inspectGranularScanDirs, resolveGranularNode } from '../preset.node'

let root: string
let baseUrl: string

function provider(): GranularProvider {
  return {
    id: 'pkg',
    contractVersion: 1,
    packageBaseUrl: baseUrl,
    components: [
      // Токены только в safelist — классы живут в общем чанке вне директории.
      { name: 'Styled', safelist: ['border-[var(--brd)]', 'rounded-[var(--radius,4px)]'] },
      // Токен только в исходнике компонента.
      { name: 'Tpl' },
      // Токен только в объявленном CSS.
      {
        name: 'Css',
        cssFiles: [new URL('css.css', baseUrl).href],
        cssFileAssetNames: ['css.css'],
      },
      // Члены группы: общий SFC должен приписаться ОБОИМ.
      { name: 'GroupA', group: 'g' },
      { name: 'GroupB', group: 'g' },
    ],
  }
}

function options(): PresetGranularNodeOptions {
  return { providers: [provider()], components: 'all' }
}

function index(opts: PresetGranularNodeOptions = options()) {
  const resolution = resolveGranularNode(opts)
  return inspectGranularTokenUsage(opts, resolution, inspectGranularScanDirs(opts).dirs)
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'granular-token-usage-'))
  baseUrl = pathToFileURL(`${root}/`).href

  for (const name of ['Styled', 'Tpl', 'Css', 'GroupA', 'GroupB']) {
    const dir = join(root, 'components', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.js'), 'export default 1\n', 'utf8')
  }

  writeFileSync(
    join(root, 'components', 'Tpl', 'tpl.js'),
    'export const cls = "bg-[var(--tpl)] text-[var(--nested,var(--deep))]"\n',
    'utf8',
  )
  // Экранированный селектор — как его пишет UnoCSS в реальном CSS.
  writeFileSync(join(root, 'css.css'), '.bg-\\[var\\(--from-css\\)\\] { color: var(--plain) }\n', 'utf8')

  const shared = join(root, 'groups', 'g', 'shared')
  mkdirSync(shared, { recursive: true })
  writeFileSync(join(shared, 'shared.js'), 'export const s = "p-[var(--shared)]"\n', 'utf8')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('inspectGranularTokenUsage: каналы', () => {
  it('safelist даёт токены без чтения файлов', () => {
    const brd = index().usage.get('brd')!.get('pkg:Styled')!
    expect(brd.via).toEqual(['safelist'])
    expect(brd.files).toEqual([])
    expect(brd.hasFallback).toBe(false)
  })

  it('fallback в var(--x, …) фиксируется как факт', () => {
    expect(index().usage.get('radius')!.get('pkg:Styled')!.hasFallback).toBe(true)
  })

  it('исходники компонента дают канал source-scan с файлом', () => {
    const tpl = index().usage.get('tpl')!.get('pkg:Tpl')!
    expect(tpl.via).toEqual(['source-scan'])
    expect(tpl.files[0]).toContain('tpl.js')
  })

  it('вложенный var(--a, var(--b)) даёт оба имени', () => {
    const found = index().usage
    expect(found.get('nested')!.has('pkg:Tpl')).toBe(true)
    expect(found.get('deep')!.has('pkg:Tpl')).toBe(true)
  })

  it('объявленный CSS читается, экранирование селектора схлопывается', () => {
    const found = index().usage
    expect(found.get('from-css')!.get('pkg:Css')!.via).toEqual(['component-css'])
    expect(found.get('plain')!.has('pkg:Css')).toBe(true)
  })

  it('общая директория группы приписывается КАЖДОМУ её члену', () => {
    // Список скан-директорий дедуплицирован по каноническому пути, поэтому
    // shared там числится за одним компонентом. Для вопроса «какие токены
    // нужны компоненту» это неверно: общий SFC входит в код обоих.
    const shared = index().usage.get('shared')!
    expect([...shared.keys()].sort()).toEqual(['pkg:GroupA', 'pkg:GroupB'])
  })
})

describe('inspectGranularTokenUsage: охват', () => {
  it('считает разделяемость: один токен у нескольких компонентов', () => {
    const usage = index().usage
    expect([...usage.get('shared')!.keys()]).toHaveLength(2)
    expect([...usage.get('tpl')!.keys()]).toHaveLength(1)
  })

  it('scan.enabled: false отключает только source-scan, safelist остаётся', () => {
    const opts: PresetGranularNodeOptions = { ...options(), scan: { enabled: false } }
    const result = index(opts)
    expect(result.sourceScanActive).toBe(false)
    expect(result.usage.get('brd')!.has('pkg:Styled')).toBe(true)
    expect(result.usage.has('tpl')).toBe(false)
  })

  it('мемоизируется по идентичности options', () => {
    const opts = options()
    const resolution = resolveGranularNode(opts)
    const dirs = inspectGranularScanDirs(opts).dirs
    expect(inspectGranularTokenUsage(opts, resolution, dirs))
      .toBe(inspectGranularTokenUsage(opts, resolution, dirs))
  })
})
