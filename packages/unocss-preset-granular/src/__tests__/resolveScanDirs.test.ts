import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { defineGranularComponent, defineGranularProvider } from '../contract'
import { buildFilesystemGlobs } from '../fs/buildContentFilesystem'
import { GranularProviderContractError, resolveComponentScanDirs } from '../fs/resolveScanDirs'
import { resolvePresetGranular } from '../preset'
import { presetGranularNode, resolveGranularFilesystemGlobs } from '../preset.node'

/**
 * Эмулирует прод-layout двух granular-провайдеров на диске:
 *   <root>/packages/pkg-a/dist/components/XOne/{index.js, chunks/Header.js}
 *   <root>/packages/pkg-a/dist/components/XTwo/{index.js}
 *   <root>/packages/pkg-b/dist/components/YDep/{index.js}
 *
 * Контракт пресета: `provider.packageBaseUrl` указывает на корень `dist/`
 * провайдера, бандлер обязан раскладывать чанки компонентов под
 * `<dist>/components/<Name>/`.
 */
function createFakePackages(root: string) {
  const mk = (dir: string) => mkdirSync(dir, { recursive: true })
  const touch = (file: string, content = '') => writeFileSync(file, content, 'utf8')

  const aXOne = join(root, 'packages/pkg-a/dist/components/XOne')
  const aXTwo = join(root, 'packages/pkg-a/dist/components/XTwo')
  const bYDep = join(root, 'packages/pkg-b/dist/components/YDep')

  mk(join(aXOne, 'chunks'))
  mk(aXTwo)
  mk(bYDep)

  // index.js — обязательный entry по контракту
  touch(join(aXOne, 'index.js'), 'export const c = "p-5"')
  // вложенный чанк должен попадать в скан (рекурсивный glob)
  touch(join(aXOne, 'chunks', 'Header-abc123.js'), 'export const c = "text-7xl"')
  touch(join(aXTwo, 'index.js'), 'export const c = "mx-7"')
  touch(join(bYDep, 'index.js'), 'export const c = "rounded-3xl"')

  // packageBaseUrl указывает на корень dist пакета
  const pkgAUrl = pathToFileURL(join(root, 'packages/pkg-a/dist/')).href
  const pkgBUrl = pathToFileURL(join(root, 'packages/pkg-b/dist/')).href

  const xOne = defineGranularComponent(
    pathToFileURL(join(aXOne, 'config.ts')).href,
    {
      name: 'XOne',
      safelist: [],
      dependencies: ['pkg-b:YDep'],
    },
  )
  const xTwo = defineGranularComponent(
    pathToFileURL(join(aXTwo, 'config.ts')).href,
    { name: 'XTwo', safelist: [] },
  )
  const yDep = defineGranularComponent(
    pathToFileURL(join(bYDep, 'config.ts')).href,
    { name: 'YDep', safelist: [] },
  )

  const providerA = defineGranularProvider({
    id: 'pkg-a',
    contractVersion: 1,
    packageBaseUrl: pkgAUrl,
    components: [xOne, xTwo],
  })
  const providerB = defineGranularProvider({
    id: 'pkg-b',
    contractVersion: 1,
    packageBaseUrl: pkgBUrl,
    components: [yDep],
  })

  return { providerA, providerB, dirs: { aXOne, aXTwo, bYDep } }
}

describe('resolveComponentScanDirs', () => {
  let root: string
  let setup: ReturnType<typeof createFakePackages>

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'granular-scan-'))
    setup = createFakePackages(root)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('включает только выбранные компоненты и их транзитивные deps', () => {
    const resolution = resolvePresetGranular({
      providers: [setup.providerA, setup.providerB],
      components: [{ provider: 'pkg-a', names: ['XOne'] }],
    })

    const dirs = resolveComponentScanDirs(resolution).map(d => d.dir)

    // realpath может раскрыть /var -> /private/var на macOS, поэтому сверяем по суффиксу
    expect(dirs.some(d => d.endsWith('pkg-a/dist/components/XOne'))).toBe(true)
    expect(dirs.some(d => d.endsWith('pkg-b/dist/components/YDep'))).toBe(true)
    expect(dirs.some(d => d.endsWith('pkg-a/dist/components/XTwo'))).toBe(false)
  })

  it('дедуплицирует директории, если тот же компонент резолвится дважды', () => {
    const resolution = resolvePresetGranular({
      providers: [setup.providerA, setup.providerB],
      components: [
        { provider: 'pkg-a', names: ['XOne'] },
        'pkg-b:YDep',
      ],
    })

    const dirs = resolveComponentScanDirs(resolution).map(d => d.dir)
    const unique = new Set(dirs)
    expect(unique.size).toBe(dirs.length)
  })

  it('warn+skip при отсутствии components/<Name>/ (нестрогий режим, по умолчанию)', () => {
    const ghost = defineGranularComponent(
      pathToFileURL(join(root, 'ghost/components/Ghost/config.ts')).href,
      { name: 'Ghost', safelist: [] },
    )
    const ghostProvider = defineGranularProvider({
      id: 'pkg-ghost',
      contractVersion: 1,
      packageBaseUrl: pathToFileURL(join(root, 'ghost/')).href,
      components: [ghost],
    })

    const resolution = resolvePresetGranular({
      providers: [ghostProvider],
      components: 'all',
    })

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {
    })
    expect(resolveComponentScanDirs(resolution)).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatch(/pkg-ghost:Ghost/)
  })

  it('в strict-режиме бросает GranularProviderContractError, если директории нет', () => {
    const ghost = defineGranularComponent(
      pathToFileURL(join(root, 'ghost-strict/components/Ghost/config.ts')).href,
      { name: 'Ghost', safelist: [] },
    )
    const ghostProvider = defineGranularProvider({
      id: 'pkg-ghost-strict',
      contractVersion: 1,
      packageBaseUrl: pathToFileURL(join(root, 'ghost-strict/')).href,
      components: [ghost],
    })

    const resolution = resolvePresetGranular({
      providers: [ghostProvider],
      components: 'all',
    })

    expect(() => resolveComponentScanDirs(resolution, { strict: true }))
      .toThrowError(GranularProviderContractError)
  })

  it('warn+skip, если components/<Name>/ есть, но в ней нет index.js', () => {
    const dir = join(root, 'no-entry/dist/components/NoEntry')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'styles.css'), '.x{}', 'utf8')

    const noEntry = defineGranularComponent(
      pathToFileURL(join(dir, 'config.ts')).href,
      { name: 'NoEntry', safelist: [] },
    )
    const provider = defineGranularProvider({
      id: 'pkg-no-entry',
      contractVersion: 1,
      packageBaseUrl: pathToFileURL(join(root, 'no-entry/dist/')).href,
      components: [noEntry],
    })

    const resolution = resolvePresetGranular({
      providers: [provider],
      components: 'all',
    })

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {
    })
    expect(resolveComponentScanDirs(resolution)).toEqual([])
    expect(warn.mock.calls[0]?.[0]).toMatch(/missing 'index\.js'/)
  })

  it('добавляет groups/<group>/shared/ для компонентов с descriptor.group, дедуплицирует на N компонентов одной группы', () => {
    // Layout фикстуры:
    //   pkg-grp/dist/components/G1/{index.js}
    //   pkg-grp/dist/components/G2/{index.js}
    //   pkg-grp/dist/groups/groupX/shared/{Shared-abc.js}
    //   pkg-grp/dist/components/Solo/{index.js}    ← без group, shared не подцепляется
    const grpRoot = join(root, 'pkg-grp/dist')
    const g1 = join(grpRoot, 'components/G1')
    const g2 = join(grpRoot, 'components/G2')
    const solo = join(grpRoot, 'components/Solo')
    const sharedX = join(grpRoot, 'groups/groupX/shared')
    mkdirSync(g1, { recursive: true })
    mkdirSync(g2, { recursive: true })
    mkdirSync(solo, { recursive: true })
    mkdirSync(sharedX, { recursive: true })
    writeFileSync(join(g1, 'index.js'), '', 'utf8')
    writeFileSync(join(g2, 'index.js'), '', 'utf8')
    writeFileSync(join(solo, 'index.js'), '', 'utf8')
    writeFileSync(join(sharedX, 'Shared-abc.js'), 'export const c="text-9xl"', 'utf8')

    const cfgG1 = defineGranularComponent(
      pathToFileURL(join(g1, 'config.ts')).href,
      { name: 'G1', group: 'groupX', safelist: [] },
    )
    const cfgG2 = defineGranularComponent(
      pathToFileURL(join(g2, 'config.ts')).href,
      { name: 'G2', group: 'groupX', safelist: [] },
    )
    const cfgSolo = defineGranularComponent(
      pathToFileURL(join(solo, 'config.ts')).href,
      { name: 'Solo', safelist: [] },
    )
    const provider = defineGranularProvider({
      id: 'pkg-grp',
      contractVersion: 1,
      packageBaseUrl: pathToFileURL(`${grpRoot}/`).href,
      components: [cfgG1, cfgG2, cfgSolo],
    })

    // Один компонент группы — shared подцепляется
    {
      const resolution = resolvePresetGranular({
        providers: [provider],
        components: [{ provider: 'pkg-grp', names: ['G1'] }],
      })
      const dirs = resolveComponentScanDirs(resolution)
      expect(dirs.some(d => d.kind === 'component' && d.dir.endsWith('components/G1'))).toBe(true)
      expect(dirs.some(d => d.kind === 'group-shared' && d.dir.endsWith('groups/groupX/shared'))).toBe(true)
    }

    // Оба компонента одной группы — shared всё ещё ОДИН (дедуп по realpath)
    {
      const resolution = resolvePresetGranular({
        providers: [provider],
        components: [{ provider: 'pkg-grp', names: ['G1', 'G2'] }],
      })
      const dirs = resolveComponentScanDirs(resolution)
      const sharedDirs = dirs.filter(d => d.kind === 'group-shared')
      expect(sharedDirs.length).toBe(1)
      expect(sharedDirs[0]!.dir.endsWith('groups/groupX/shared')).toBe(true)
    }

    // Только Solo (без group) — shared НЕ сканируется, лишних классов из чужой группы нет
    {
      const resolution = resolvePresetGranular({
        providers: [provider],
        components: [{ provider: 'pkg-grp', names: ['Solo'] }],
      })
      const dirs = resolveComponentScanDirs(resolution)
      expect(dirs.some(d => d.kind === 'group-shared')).toBe(false)
      expect(dirs.some(d => d.dir.endsWith('groups/groupX/shared'))).toBe(false)
    }
  })

  it('group задан, но groups/<group>/shared/ отсутствует — тихо пропускается без warn (опциональная зона)', () => {
    const root2 = join(root, 'pkg-grp-empty/dist')
    const cdir = join(root2, 'components/Empty')
    mkdirSync(cdir, { recursive: true })
    writeFileSync(join(cdir, 'index.js'), '', 'utf8')

    const cfg = defineGranularComponent(
      pathToFileURL(join(cdir, 'config.ts')).href,
      { name: 'Empty', group: 'groupNoShared', safelist: [] },
    )
    const provider = defineGranularProvider({
      id: 'pkg-grp-empty',
      contractVersion: 1,
      packageBaseUrl: pathToFileURL(`${root2}/`).href,
      components: [cfg],
    })
    const resolution = resolvePresetGranular({
      providers: [provider],
      components: 'all',
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const dirs = resolveComponentScanDirs(resolution)
    expect(dirs.length).toBe(1)
    expect(dirs[0]!.kind).toBe('component')
    expect(warn).not.toHaveBeenCalled()
  })

  it('strict-режим бросает GranularProviderContractError при отсутствии index.js', () => {
    const dir = join(root, 'no-entry-strict/dist/components/NoEntry')
    mkdirSync(dir, { recursive: true })

    const noEntry = defineGranularComponent(
      pathToFileURL(join(dir, 'config.ts')).href,
      { name: 'NoEntry', safelist: [] },
    )
    const provider = defineGranularProvider({
      id: 'pkg-no-entry-strict',
      contractVersion: 1,
      packageBaseUrl: pathToFileURL(join(root, 'no-entry-strict/dist/')).href,
      components: [noEntry],
    })

    const resolution = resolvePresetGranular({
      providers: [provider],
      components: 'all',
    })

    expect(() => resolveComponentScanDirs(resolution, { strict: true }))
      .toThrow(/missing/i)
  })
})

describe('buildFilesystemGlobs', () => {
  it('формирует РЕКУРСИВНЫЙ glob на директорию с дефолтными расширениями', () => {
    const [glob] = buildFilesystemGlobs({ dirs: ['/abs/pkg/dist/components/X'] })
    expect(glob).toMatch(/^\/abs\/pkg\/dist\/components\/X\/\*\*\/\*\.\{.*vue.*\}$/)
    expect(glob).toContain('js,')
    expect(glob).toContain(',vue')
  })

  it('убирает завершающий слеш у директорий', () => {
    const [glob] = buildFilesystemGlobs({ dirs: ['/abs/pkg/dist/components/X/'] })
    expect(glob.startsWith('/abs/pkg/dist/components/X/**/*')).toBe(true)
  })

  it('добавляет extraGlobs и дедуплицирует', () => {
    const globs = buildFilesystemGlobs({
      dirs: ['/a', '/a'],
      extraGlobs: ['/b/**/*.ts', '/a/**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx,vue}'],
    })
    expect(globs.length).toBe(2) // /a/... + /b/... — без дублей
    expect(globs.includes('/b/**/*.ts')).toBe(true)
  })

  it('с одним расширением использует его напрямую без {}', () => {
    const [glob] = buildFilesystemGlobs({ dirs: ['/x'], extensions: ['vue'], replaceExtensions: true })
    expect(glob).toBe('/x/**/*.vue')
  })

  it('extensions ДОПОЛНЯЕТ дефолтный список, а не заменяет его', () => {
    const [glob] = buildFilesystemGlobs({ dirs: ['/x'], extensions: ['mdx'] })
    expect(glob).toBe('/x/**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx,vue,mdx}')
  })

  it('лидирующая точка в extensions необязательна и не даёт дублей', () => {
    const [glob] = buildFilesystemGlobs({ dirs: ['/x'], extensions: ['.mdx', 'vue'] })
    expect(glob).toBe('/x/**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx,vue,mdx}')
  })

  it('replaceExtensions=true задаёт список целиком', () => {
    const [glob] = buildFilesystemGlobs({ dirs: ['/x'], extensions: ['vue', 'mdx'], replaceExtensions: true })
    expect(glob).toBe('/x/**/*.{vue,mdx}')
  })

  it('replaceExtensions=true без extensions оставляет только extraGlobs', () => {
    expect(buildFilesystemGlobs({ dirs: ['/x'], replaceExtensions: true, extraGlobs: ['/b/**/*.ts'] }))
      .toEqual(['/b/**/*.ts'])
  })
})

describe('presetGranularNode content.filesystem', () => {
  let root: string
  let setup: ReturnType<typeof createFakePackages>

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'granular-preset-'))
    setup = createFakePackages(root)
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('пресет отдаёт content.filesystem только для выбранных + deps', () => {
    const preset = presetGranularNode({
      providers: [setup.providerA, setup.providerB],
      components: [{ provider: 'pkg-a', names: ['XOne'] }],
    })

    const fs = preset.content?.filesystem ?? []
    expect(fs.some(g => g.includes('pkg-a/dist/components/XOne'))).toBe(true)
    expect(fs.some(g => g.includes('pkg-b/dist/components/YDep'))).toBe(true)
    expect(fs.some(g => g.includes('pkg-a/dist/components/XTwo'))).toBe(false)
  })

  it('scan.enabled=false отключает автоскан', () => {
    const preset = presetGranularNode({
      providers: [setup.providerA, setup.providerB],
      components: [{ provider: 'pkg-a', names: ['XOne'] }],
      scan: { enabled: false },
    })

    expect(preset.content?.filesystem ?? []).toEqual([])
  })

  it('scan.enabled=false сохраняет pipeline.include', () => {
    const preset = presetGranularNode({
      providers: [setup.providerA, setup.providerB],
      components: [{ provider: 'pkg-a', names: ['XOne'] }],
      scan: { enabled: false },
    })

    // Пустые globs не повод схлопывать весь `content` в undefined: стандартный
    // фильтр расширений в pipeline.include от числа globs не зависит (AUDIT A6).
    const include = (preset.content?.pipeline as { include?: RegExp[] } | undefined)?.include ?? []
    expect(include.length).toBeGreaterThan(0)
    expect(include.some(re => re.test('/app/src/App.vue'))).toBe(true)
  })

  it('scan.extraGlobs добавляются в итоговый список', () => {
    const preset = presetGranularNode({
      providers: [setup.providerA, setup.providerB],
      components: [{ provider: 'pkg-a', names: ['XOne'] }],
      scan: { extraGlobs: ['extra-pattern/**/*.vue'] },
    })

    const fs = preset.content?.filesystem ?? []
    expect(fs).toContain('extra-pattern/**/*.vue')
  })

  it('resolveGranularFilesystemGlobs доступен как самостоятельный helper', () => {
    const globs = resolveGranularFilesystemGlobs({
      providers: [setup.providerA, setup.providerB],
      components: [{ provider: 'pkg-b', names: ['YDep'] }],
    })
    expect(globs.length).toBe(1)
    expect(globs[0]).toContain('pkg-b/dist/components/YDep')
  })

  it('scan.strict пробрасывается в резолвер и бросает на нарушении контракта', () => {
    const ghost = defineGranularComponent(
      pathToFileURL(join(setup.dirs.aXOne, '..', 'Ghost', 'config.ts')).href,
      { name: 'Ghost', safelist: [] },
    )
    const provider = defineGranularProvider({
      id: 'pkg-ghost-preset',
      contractVersion: 1,
      packageBaseUrl: setup.providerA.packageBaseUrl,
      components: [ghost],
    })
    expect(() => resolveGranularFilesystemGlobs({
      providers: [provider],
      components: 'all',
      scan: { strict: true },
    })).toThrow(GranularProviderContractError)
  })
})
