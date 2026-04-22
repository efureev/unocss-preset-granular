import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { defineGranularComponent, defineGranularProvider } from '../contract'
import { buildFilesystemGlobs } from '../fs/buildContentFilesystem'
import { resolveComponentScanDirs } from '../fs/resolveScanDirs'
import { resolvePresetGranular } from '../preset'
import { presetGranularNode, resolveGranularFilesystemGlobs } from '../preset.node'

/**
 * Создаёт мини-пакет c двумя компонентами на диске:
 *   <root>/packages/pkg-a/src/components/XOne/{config.ts, styles.css, XOne.vue}
 *   <root>/packages/pkg-a/src/components/XTwo/{config.ts, styles.css, XTwo.vue}
 *   <root>/packages/pkg-b/src/components/YDep/{config.ts, styles.css, YDep.vue}
 */
function createFakePackages(root: string) {
  const mk = (dir: string) => {
    mkdirSync(dir, { recursive: true })
  }
  const touch = (file: string, content = '') => writeFileSync(file, content, 'utf8')

  const aXOne = join(root, 'packages/pkg-a/src/components/XOne')
  const aXTwo = join(root, 'packages/pkg-a/src/components/XTwo')
  const bYDep = join(root, 'packages/pkg-b/src/components/YDep')

  mk(aXOne)
  mk(aXTwo)
  mk(bYDep)

  touch(join(aXOne, 'styles.css'), '.x-one{color:red}')
  touch(join(aXOne, 'XOne.vue'), '<template><div class="p-5" /></template>')
  touch(join(aXTwo, 'styles.css'), '.x-two{}')
  touch(join(aXTwo, 'XTwo.vue'), '<template><div class="mx-7" /></template>')
  touch(join(bYDep, 'styles.css'), '.y-dep{}')
  touch(join(bYDep, 'YDep.vue'), '<template><div class="rounded-3xl" /></template>')

  const pkgAUrl = pathToFileURL(join(root, 'packages/pkg-a/src/')).href
  const pkgBUrl = pathToFileURL(join(root, 'packages/pkg-b/src/')).href

  const xOne = defineGranularComponent(
    pathToFileURL(join(aXOne, 'config.ts')).href,
    {
      name: 'XOne',
      safelist: [],
      cssFiles: ['./styles.css'],
      dependencies: ['pkg-b:YDep'],
    },
  )
  const xTwo = defineGranularComponent(
    pathToFileURL(join(aXTwo, 'config.ts')).href,
    { name: 'XTwo', safelist: [], cssFiles: ['./styles.css'] },
  )
  const yDep = defineGranularComponent(
    pathToFileURL(join(bYDep, 'config.ts')).href,
    { name: 'YDep', safelist: [], cssFiles: ['./styles.css'] },
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
    expect(dirs.some(d => d.endsWith('pkg-a/src/components/XOne'))).toBe(true)
    expect(dirs.some(d => d.endsWith('pkg-b/src/components/YDep'))).toBe(true)
    expect(dirs.some(d => d.endsWith('pkg-a/src/components/XTwo'))).toBe(false)
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

  it('пропускает компоненты, директория которых не существует', () => {
    const ghost = defineGranularComponent(
      pathToFileURL(join(root, 'ghost/config.ts')).href,
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

    expect(resolveComponentScanDirs(resolution)).toEqual([])
  })
})

describe('buildFilesystemGlobs', () => {
  it('формирует glob на директорию с дефолтными расширениями', () => {
    const [glob] = buildFilesystemGlobs({ dirs: ['/abs/pkg/src/comp'] })
    expect(glob).toMatch(/^\/abs\/pkg\/src\/comp\/\*\*\/\*\.\{.*vue.*\}$/)
    expect(glob).toContain('js,')
    expect(glob).toContain(',vue')
  })

  it('убирает завершающий слеш у директорий', () => {
    const [glob] = buildFilesystemGlobs({ dirs: ['/abs/pkg/src/comp/'] })
    expect(glob.startsWith('/abs/pkg/src/comp/**/*')).toBe(true)
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
    const [glob] = buildFilesystemGlobs({ dirs: ['/x'], extensions: ['vue'] })
    expect(glob).toBe('/x/**/*.vue')
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
    expect(fs.some(g => g.includes('pkg-a/src/components/XOne'))).toBe(true)
    expect(fs.some(g => g.includes('pkg-b/src/components/YDep'))).toBe(true)
    expect(fs.some(g => g.includes('pkg-a/src/components/XTwo'))).toBe(false)
  })

  it('scan.enabled=false отключает автоскан', () => {
    const preset = presetGranularNode({
      providers: [setup.providerA, setup.providerB],
      components: [{ provider: 'pkg-a', names: ['XOne'] }],
      scan: { enabled: false },
    })

    expect(preset.content?.filesystem ?? []).toEqual([])
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
    expect(globs[0]).toContain('pkg-b/src/components/YDep')
  })
})
