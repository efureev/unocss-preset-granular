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
      // Имя токена собирается в рантайме: `var()` в исходниках нет вовсе.
      { name: 'Dyn' },
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

  for (const name of ['Styled', 'Tpl', 'Css', 'Dyn', 'GroupA', 'GroupB']) {
    const dir = join(root, 'components', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.js'), 'export default 1\n', 'utf8')
  }

  writeFileSync(
    join(root, 'components', 'Tpl', 'tpl.js'),
    'export const cls = "bg-[var(--tpl)] text-[var(--nested,var(--deep))]"\n',
    'utf8',
  )
  // Динамическое имя: `var(${v})` собирается в рантайме, а само имя лежит
  // строковым литералом. Списано с живого кода `@feugene/granularity`.
  writeFileSync(
    join(root, 'components', 'Dyn', 'z.js'),
    [
      'const zVar = "--z-dropdown"',
      // `$` и `{` разъединены намеренно: иначе eslint примет подстановку
      // внутри обычной строки за забытый шаблонный литерал.
      `export const z = \`var($${'{'}zVar})\``,
      'export const style = { "--dyn-bg": "red" }',
      // Ловушки для ложных срабатываний: не целое имя в кавычках.
      'export const notAName = "--dyn-fake: 8px"',
      'export const alsoNot = "border: 1px solid var(--dyn-via-var)"',
    ].join('\n'),
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

describe('inspectGranularTokenUsage: канал source-literal', () => {
  it('имя, собираемое в var() из переменной, находится литералом', () => {
    // `var(--z-dropdown)` в исходниках нет НИ РАЗУ — только `var(${zVar})`.
    const entry = index().usage.get('z-dropdown')!.get('pkg:Dyn')!
    expect(entry.via).toEqual(['source-literal'])
    expect(entry.files[0]).toContain('z.js')
  })

  it('ключ объекта инлайн-стиля тоже находится', () => {
    expect(index().usage.get('dyn-bg')!.get('pkg:Dyn')!.via).toEqual(['source-literal'])
  })

  it('строка стиля целиком именем токена НЕ считается', () => {
    // `'--dyn-fake: 8px'` — кавычка не закрывается сразу после имени.
    expect(index().usage.has('dyn-fake')).toBe(false)
  })

  it('var() внутри строки идёт своим каналом, а не литеральным', () => {
    expect(index().usage.get('dyn-via-var')!.get('pkg:Dyn')!.via).toEqual(['source-scan'])
  })

  it('cSS-файлы каналом литералов не сканируются', () => {
    // В `css.css` лежит `.bg-\\[var\\(--from-css\\)\\]`; после снятия
    // экранирования это `var(`-потребление, а не литерал.
    expect(index().usage.get('from-css')!.get('pkg:Css')!.via).toEqual(['component-css'])
  })
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
