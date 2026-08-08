import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { defineGranularComponent, defineGranularProvider } from '../contract'
import { GranularTokenRefError, materializeGranularOptions } from '../node-utils/materializeRefs'
import { getGranularThemeManifest } from '../node-utils/themeManifest'
import { getGranularThemeCss, resolveGranularNode } from '../preset.node'

let root: string
/** URL корня «пакета»: src/ с исходниками, dist/ — как у опубликованного. */
let srcBase: string
let distBase: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'granular-refs-'))

  const srcThemes = join(root, 'src/components/XTok/themes')
  mkdirSync(srcThemes, { recursive: true })
  writeFileSync(join(srcThemes, 'light.css'), ':root { --brd: #eee; }', 'utf8')
  writeFileSync(join(srcThemes, 'dark.css'), '.dark, [data-theme="dark"] { --brd: #333; }', 'utf8')

  // Опубликованный пакет: исходников нет, есть только dist по контрактному
  // пути `components/<Name>/<file>`.
  const distThemes = join(root, 'dist/components/XTok/themes')
  mkdirSync(distThemes, { recursive: true })
  writeFileSync(join(distThemes, 'light.css'), ':root { --brd: #dist; }', 'utf8')

  srcBase = pathToFileURL(`${join(root, 'src')}/`).href
  distBase = pathToFileURL(`${join(root, 'dist')}/`).href
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Компонент, объявляющий токены ССЫЛКОЙ — без единого импорта из `/node`. */
function tokenizedComponent() {
  return defineGranularComponent(
    pathToFileURL(join(root, 'src/components/XTok/config.ts')).href,
    {
      name: 'XTok',
      tokenDefinitionsRef: {
        light: './themes/light.css',
        dark: { url: './themes/dark.css', selector: '.dark, [data-theme="dark"]' },
      },
    },
  )
}

describe('defineGranularComponent: нормализация ссылок', () => {
  it('относительный путь → абсолютный URL + assetName для опубликованного пакета', () => {
    const descriptor = tokenizedComponent()

    expect(descriptor.tokenDefinitionsRef!.light).toEqual({
      url: pathToFileURL(join(root, 'src/components/XTok/themes/light.css')).href,
      assetName: 'components/XTok/themes/light.css',
    })
    // Объектная форма сохраняет свои опции.
    expect(descriptor.tokenDefinitionsRef!.dark).toMatchObject({
      selector: '.dark, [data-theme="dark"]',
      assetName: 'components/XTok/themes/dark.css',
    })
  })
})

describe('материализация ссылок в node-слое', () => {
  it('ссылки превращаются в tokenDefinitions и доезжают до CSS', async () => {
    const provider = defineGranularProvider({
      id: 'refs',
      contractVersion: 1,
      packageBaseUrl: srcBase,
      components: [tokenizedComponent()],
    })
    const options = { providers: [provider], components: 'all' as const, themes: { names: ['light', 'dark'] } }

    const css = await getGranularThemeCss(options)
    expect(css).toContain('--brd: #eee')
    expect(css).toContain('--brd: #333')
    expect(css).toContain('.dark, [data-theme="dark"]')
  })

  it('манифест тем видит селекторы из ссылок — активация выводится', () => {
    const provider = defineGranularProvider({
      id: 'refs',
      contractVersion: 1,
      packageBaseUrl: srcBase,
      components: [tokenizedComponent()],
    })

    const manifest = getGranularThemeManifest({
      providers: [provider],
      components: 'all',
      themes: { names: ['light', 'dark'] },
    })

    expect(manifest.themes[1].activation).toEqual({ type: 'attribute', name: 'data-theme', value: 'dark' })
  })

  it('литеральные tokenDefinitions имеют приоритет над ссылкой на ту же тему', async () => {
    const descriptor = {
      ...tokenizedComponent(),
      tokenDefinitions: { light: { selector: ':root', tokens: { brd: 'литерал' } } },
    }
    const provider = defineGranularProvider({
      id: 'refs',
      contractVersion: 1,
      packageBaseUrl: srcBase,
      components: [descriptor],
    })

    const css = await getGranularThemeCss({ providers: [provider], components: 'all', themes: { names: ['light'] } })
    expect(css).toContain('--brd: литерал')
    expect(css).not.toContain('#eee')
  })

  it('в опубликованном пакете срабатывает fallback по assetName', async () => {
    // `url` ведёт в src, которого в этом «пакете» нет; packageBaseUrl — dist.
    const provider = defineGranularProvider({
      id: 'published',
      contractVersion: 1,
      packageBaseUrl: distBase,
      components: [defineGranularComponent(
        pathToFileURL(join(root, 'nowhere/components/XTok/config.ts')).href,
        { name: 'XTok', tokenDefinitionsRef: { light: './themes/light.css' } },
      )],
    })

    const css = await getGranularThemeCss({ providers: [provider], components: 'all', themes: { names: ['light'] } })
    expect(css).toContain('--brd: #dist')
  })

  it('битая ссылка — ошибка с провайдером, компонентом и темой', () => {
    const provider = defineGranularProvider({
      id: 'broken',
      contractVersion: 1,
      packageBaseUrl: srcBase,
      components: [defineGranularComponent(
        pathToFileURL(join(root, 'src/components/Nope/config.ts')).href,
        { name: 'Nope', tokenDefinitionsRef: { dark: './themes/missing.css' } },
      )],
    })

    try {
      resolveGranularNode({ providers: [provider], components: 'all', themes: { names: ['dark'] } })
      throw new Error('should have thrown')
    }
    catch (error) {
      expect(error).toBeInstanceOf(GranularTokenRefError)
      expect((error as Error).message).toContain(`component 'Nope'`)
      expect((error as Error).message).toContain(`provider 'broken'`)
      expect((error as Error).message).toContain(`tokenDefinitionsRef['dark']`)
      // Сообщение обязано подсказывать выход: на этом спотыкается каждый,
      // кто объявил ссылку строкой, а файл не эмитится сборкой пакета.
      expect((error as Error).message).toContain('new URL(')
    }
  })

  it('ссылка на уровне провайдера тоже разворачивается', async () => {
    const provider = defineGranularProvider({
      id: 'pkg-level',
      contractVersion: 1,
      packageBaseUrl: srcBase,
      components: [],
      theme: {
        tokenDefinitionsRef: {
          light: { url: `${srcBase}components/XTok/themes/light.css` },
        },
      },
    })

    const css = await getGranularThemeCss({ providers: [provider], themes: { names: ['light'] } })
    expect(css).toContain('--brd: #eee')
  })
})

describe('материализация читает только темы, которые могут стать активными', () => {
  it('битая ссылка НЕАКТИВНОЙ темы не валит сборку', async () => {
    const provider = defineGranularProvider({
      id: 'partial',
      contractVersion: 1,
      packageBaseUrl: srcBase,
      components: [defineGranularComponent(
        pathToFileURL(join(root, 'src/components/XTok/config.ts')).href,
        {
          name: 'XTok',
          tokenDefinitionsRef: {
            light: './themes/light.css',
            // Файла нет — но темы нет в `names`, читать его и не нужно.
            corporate: './themes/missing.css',
          },
        },
      )],
    })

    const css = await getGranularThemeCss({
      providers: [provider],
      components: 'all',
      themes: { names: ['light'] },
    })
    expect(css).toContain('--brd: #eee')
  })

  it('битая ссылка АКТИВНОЙ темы по-прежнему падает типизированно', () => {
    const provider = defineGranularProvider({
      id: 'partial',
      contractVersion: 1,
      packageBaseUrl: srcBase,
      components: [defineGranularComponent(
        pathToFileURL(join(root, 'src/components/XTok/config.ts')).href,
        { name: 'XTok', tokenDefinitionsRef: { corporate: './themes/missing.css' } },
      )],
    })

    expect(() => resolveGranularNode({
      providers: [provider],
      components: 'all',
      themes: { names: ['corporate'] },
    })).toThrow(GranularTokenRefError)
  })

  it('база extends, поставляемая только ссылкой, материализуется', async () => {
    // `light` в `names` не входит, но нужна как база — её ссылка обязана
    // прочитаться, иначе наследовать будет нечего.
    const provider = defineGranularProvider({
      id: 'base-by-ref',
      contractVersion: 1,
      packageBaseUrl: srcBase,
      components: [tokenizedComponent()],
    })

    const css = await getGranularThemeCss({
      providers: [provider],
      components: 'all',
      themes: {
        names: ['emerald'],
        define: { emerald: { extends: 'light', selector: '[data-theme="emerald"]' } },
      },
    })
    expect(css).toContain('[data-theme="emerald"]')
    expect(css).toContain('--brd: #eee')
  })

  it('defaultThemes транзитивного донора учитываются при фильтрации', async () => {
    // Активный набор выводится из `defaultThemes` ДОНОРА, которого приложение
    // не перечисляло, — обход графа при материализации обязан его увидеть.
    const donor = defineGranularProvider({
      id: 'donor-defaults',
      contractVersion: 1,
      packageBaseUrl: srcBase,
      components: [],
      theme: {
        defaultThemes: ['dark'],
        tokenDefinitionsRef: {
          dark: {
            url: `${srcBase}components/XTok/themes/dark.css`,
            selector: '.dark, [data-theme="dark"]',
          },
        },
      },
    })
    const parent = defineGranularProvider({
      id: 'parent',
      contractVersion: 1,
      packageBaseUrl: srcBase,
      components: [],
      dependencies: [donor],
    })

    const css = await getGranularThemeCss({ providers: [parent] })
    expect(css).toContain('--brd: #333')
  })
})

describe('материализация не ломает граф провайдеров', () => {
  it('провайдер без ссылок возвращается по идентичности', () => {
    const plain = defineGranularProvider({
      id: 'plain',
      contractVersion: 1,
      packageBaseUrl: srcBase,
      components: [{ name: 'A', safelist: ['a'] }],
    })
    const options = { providers: [plain] }

    expect(materializeGranularOptions(options)).toBe(options)
    expect(materializeGranularOptions(options).providers[0]).toBe(plain)
  })

  it('результат стабилен по ссылке — на нём держатся кэши ниже', () => {
    const options = {
      providers: [defineGranularProvider({
        id: 'refs',
        contractVersion: 1,
        packageBaseUrl: srcBase,
        components: [tokenizedComponent()],
      })],
      components: 'all' as const,
    }

    expect(materializeGranularOptions(options)).toBe(materializeGranularOptions(options))
    expect(resolveGranularNode(options)).toBe(resolveGranularNode(options))
  })

  it('diamond-граф не превращается в дубль id', () => {
    // Донор со ссылками виден двум родителям. Если материализация создаст два
    // его инстанса, `expandProviders` бросит DuplicateProviderIdError.
    const donor = defineGranularProvider({
      id: 'donor',
      contractVersion: 1,
      packageBaseUrl: srcBase,
      components: [tokenizedComponent()],
    })
    const left = defineGranularProvider({
      id: 'left',
      contractVersion: 1,
      packageBaseUrl: srcBase,
      components: [],
      dependencies: [donor],
    })
    const right = defineGranularProvider({
      id: 'right',
      contractVersion: 1,
      packageBaseUrl: srcBase,
      components: [],
      dependencies: [donor],
    })

    const resolution = resolveGranularNode({ providers: [left, right], components: 'all' })
    expect(resolution.providers.map(p => p.id)).toEqual(['donor', 'left', 'right'])
  })
})
