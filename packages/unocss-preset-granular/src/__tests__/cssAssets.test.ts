import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { beforeEach, describe, expect, it } from 'vitest'
import { defineGranularComponent, defineGranularProvider } from '../contract'
import {
  GranularCssAssetError,
  granularCssAssetsPlugin,
  planGranularCssAssets,
} from '../vite'

/** Временный «пакет»: `src/components/<Name>/themes/*.css` + пустой `dist`. */
async function makePackage(): Promise<{ root: string, configUrl: (name: string) => string }> {
  const root = await mkdtemp(join(tmpdir(), 'granular-css-assets-'))
  return {
    root,
    configUrl: (name: string) =>
      pathToFileURL(join(root, 'src', 'components', name, 'config.ts')).href,
  }
}

async function writeThemeCss(root: string, name: string, file: string, body: string): Promise<void> {
  const dir = join(root, 'src', 'components', name, 'themes')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, file), body, 'utf8')
}

describe('planGranularCssAssets', () => {
  it('строковая ссылка планируется на контрактный путь assetName', () => {
    const descriptor = defineGranularComponent('file:///pkg/src/components/XTok/config.ts', {
      name: 'XTok',
      tokenDefinitionsRef: { light: './themes/light.css' },
    })

    const { copies, skipped } = planGranularCssAssets({ components: [descriptor] })

    expect(skipped).toEqual([])
    expect(copies).toHaveLength(1)
    expect(copies[0].assetName).toBe('components/XTok/themes/light.css')
    expect(copies[0].from).toBe('/pkg/src/components/XTok/themes/light.css')
  })

  it('assetName плана совпадает с тем, что читает node-слой', () => {
    const descriptor = defineGranularComponent('file:///pkg/src/components/XTok/config.ts', {
      name: 'XTok',
      tokenDefinitionsRef: { light: './themes/light.css' },
    })
    const { copies } = planGranularCssAssets({ components: [descriptor] })

    // Инвариант плагина: он кладёт файл ровно туда, куда смотрит фолбэк.
    // Приведение типа не нужно — в дескрипторе ссылка уже нормализована
    // в объект, строковой формы там по типу не бывает.
    expect(copies[0].assetName).toBe(descriptor.tokenDefinitionsRef!.light.assetName)
  })

  it('data:-ссылка пропускается — содержимое уже в чанке', () => {
    const descriptor = defineGranularComponent('file:///pkg/src/components/XTok/config.ts', {
      name: 'XTok',
      tokenDefinitionsRef: { light: 'data:text/css,%3Aroot%7B--a%3A1px%7D' },
    })

    const { copies, skipped } = planGranularCssAssets({ components: [descriptor] })

    expect(copies).toEqual([])
    expect(skipped).toEqual([
      { subject: '<components>:XTok (theme "light")', url: 'data:…', reason: 'inlined-data-url' },
    ])
  })

  it('package-wide ссылка без assetName попадает в skipped, а не теряется', () => {
    // `defineGranularProvider` — identity, `assetName` она не проставляет.
    const provider = defineGranularProvider({
      id: '@t/pkg',
      contractVersion: 1,
      packageBaseUrl: 'file:///pkg/dist/',
      components: [],
      theme: { tokenDefinitionsRef: { light: './styles/light.css' } },
    })

    const { copies, skipped } = planGranularCssAssets({ providers: [provider] })

    expect(copies).toEqual([])
    expect(skipped).toEqual([
      { subject: '@t/pkg (theme "light")', url: './styles/light.css', reason: 'no-asset-name' },
    ])
  })

  it('cssFiles планируются симметрично токен-ссылкам', () => {
    const descriptor = defineGranularComponent('file:///pkg/src/components/XCss/config.ts', {
      name: 'XCss',
      cssFiles: ['./extra.css'],
    })

    const { copies } = planGranularCssAssets({ components: [descriptor] })

    expect(copies).toHaveLength(1)
    expect(copies[0].assetName).toBe('components/XCss/extra.css')
    expect(copies[0].assetName).toBe(descriptor.cssFileAssetNames![0])
  })

  it('одинаковые пары источник/назначение не дублируются', () => {
    const descriptor = defineGranularComponent('file:///pkg/src/components/XTok/config.ts', {
      name: 'XTok',
      tokenDefinitionsRef: { light: './themes/light.css' },
    })
    const provider = defineGranularProvider({
      id: '@t/pkg',
      contractVersion: 1,
      packageBaseUrl: 'file:///pkg/dist/',
      components: [descriptor],
    })

    const { copies } = planGranularCssAssets({ providers: [provider], components: [descriptor] })

    expect(copies).toHaveLength(1)
  })
})

describe('granularCssAssetsPlugin', () => {
  let pkg: Awaited<ReturnType<typeof makePackage>>

  beforeEach(async () => {
    pkg = await makePackage()
  })

  it('копирует CSS в dist по assetName', async () => {
    await writeThemeCss(pkg.root, 'XTok', 'light.css', ':root{--a:1px}')

    const descriptor = defineGranularComponent(pkg.configUrl('XTok'), {
      name: 'XTok',
      tokenDefinitionsRef: { light: './themes/light.css' },
    })

    const plugin = granularCssAssetsPlugin({ components: [descriptor] })
    plugin.configResolved({ root: pkg.root, build: { outDir: 'dist' } })
    await plugin.closeBundle()

    const written = await readFile(
      join(pkg.root, 'dist', 'components', 'XTok', 'themes', 'light.css'),
      'utf8',
    )
    expect(written).toBe(':root{--a:1px}')
  })

  it('отсутствующий исходник — ошибка сборки, а не тихая публикация битой ссылки', async () => {
    const descriptor = defineGranularComponent(pkg.configUrl('XGone'), {
      name: 'XGone',
      tokenDefinitionsRef: { light: './themes/light.css' },
    })

    const plugin = granularCssAssetsPlugin({ components: [descriptor] })
    plugin.configResolved({ root: pkg.root, build: { outDir: 'dist' } })

    await expect(plugin.closeBundle()).rejects.toThrow(GranularCssAssetError)
  })

  it('onMissing: warn — предупреждает и продолжает', async () => {
    const descriptor = defineGranularComponent(pkg.configUrl('XGone'), {
      name: 'XGone',
      tokenDefinitionsRef: { light: './themes/light.css' },
    })

    const plugin = granularCssAssetsPlugin({ components: [descriptor], onMissing: 'warn' })
    plugin.configResolved({ root: pkg.root, build: { outDir: 'dist' } })

    await expect(plugin.closeBundle()).resolves.toBeUndefined()
  })

  it('assetName не может вылезти за пределы outDir', async () => {
    await writeThemeCss(pkg.root, 'XEsc', 'light.css', ':root{}')

    const descriptor = defineGranularComponent(pkg.configUrl('XEsc'), {
      name: 'XEsc',
      tokenDefinitionsRef: {
        light: {
          url: './themes/light.css',
          assetName: '../../../etc/pwned.css',
        },
      },
    })

    const plugin = granularCssAssetsPlugin({ components: [descriptor] })
    plugin.configResolved({ root: pkg.root, build: { outDir: 'dist' } })

    await expect(plugin.closeBundle()).rejects.toThrow(/escapes the output directory/)
  })

  it('outDir из опций перебивает build.outDir', async () => {
    await writeThemeCss(pkg.root, 'XTok', 'light.css', ':root{--a:1px}')

    const descriptor = defineGranularComponent(pkg.configUrl('XTok'), {
      name: 'XTok',
      tokenDefinitionsRef: { light: './themes/light.css' },
    })

    const plugin = granularCssAssetsPlugin({ components: [descriptor], outDir: 'out' })
    plugin.configResolved({ root: pkg.root, build: { outDir: 'dist' } })
    await plugin.closeBundle()

    await expect(
      readFile(join(pkg.root, 'out', 'components', 'XTok', 'themes', 'light.css'), 'utf8'),
    ).resolves.toBe(':root{--a:1px}')
  })
})
