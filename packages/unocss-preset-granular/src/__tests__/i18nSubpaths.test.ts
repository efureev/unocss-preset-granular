import type { GranularProvider } from '../contract'

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { defineGranularProvider } from '../contract'
import { inspectI18nSubpaths } from '../fs/i18nSubpaths'

let root: string

/**
 * Фикстура повторяет реальную раскладку: `packageBaseUrl` смотрит в `dist/`,
 * а `package.json` лежит уровнем выше. Именно поэтому инспектор идёт вверх, а
 * не читает соседний файл.
 */
function writePackage(name: string, manifest: Record<string, unknown>): string {
  const dir = join(root, name.replace(/[@/]/g, '_'))
  mkdirSync(join(dir, 'dist'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, ...manifest }), 'utf8')
  return `${pathToFileURL(join(dir, 'dist')).href}/`
}

function provider(id: string, baseUrl: string, patch: Partial<GranularProvider> = {}): GranularProvider {
  return defineGranularProvider({
    id,
    contractVersion: 1,
    packageBaseUrl: baseUrl,
    components: [],
    ...patch,
  })
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'granular-i18n-subpaths-'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('подпути строк в exports пакета', () => {
  it('оба подпути объявлены — молчит', () => {
    const base = writePackage('@x/full', {
      exports: { '.': './dist/index.js', './i18n': './dist/i18n/index.js', './i18n/all': './dist/i18n/all.js' },
    })

    expect(inspectI18nSubpaths([provider('@x/full', base, { i18n: { locales: ['en'] } })])).toEqual([])
  })

  it('агрегат забыт — находка именно на allEntry', () => {
    // Самый частый недосмотр: `./i18n` добавили, про `./i18n/all` забыли.
    // Падает при этом сборка потребителя, и в трейсе будет его приложение.
    const base = writePackage('@x/no-all', {
      exports: { '.': './dist/index.js', './i18n': './dist/i18n/index.js' },
    })

    const found = inspectI18nSubpaths([provider('@x/no-all', base, { i18n: { locales: ['en'] } })])

    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ field: 'allEntry', subpath: './i18n/all' })
  })

  it('явный подпуть проверяется так же, как дефолтный', () => {
    const base = writePackage('@x/custom', {
      exports: { './strings': './dist/strings.js', './strings/all': './dist/strings-all.js' },
    })

    const ok = provider('@x/custom', base, {
      i18n: { locales: ['en'], entry: '@x/custom/strings' },
    })
    expect(inspectI18nSubpaths([ok])).toEqual([])

    const broken = provider('@x/custom', base, {
      i18n: { locales: ['en'], entry: '@x/custom/nope' },
    })
    expect(inspectI18nSubpaths([broken]).map(f => f.subpath)).toEqual(['./nope', './nope/all'])
  })

  it('паттерны в exports — пропуск: подпуть мог попасть под любой из них', () => {
    const base = writePackage('@x/patterns', {
      exports: { '.': './dist/index.js', './*': './dist/*.js' },
    })

    expect(inspectI18nSubpaths([provider('@x/patterns', base, { i18n: { locales: ['en'] } })])).toEqual([])
  })

  it('нет exports — судить не о чем', () => {
    const base = writePackage('@x/legacy', { main: './dist/index.js' })

    expect(inspectI18nSubpaths([provider('@x/legacy', base, { i18n: { locales: ['en'] } })])).toEqual([])
  })

  it('чужой пакет в спецификаторе не проверяется', () => {
    // Провайдер вправе указать на соседний пакет; его `exports` — не наше дело.
    const base = writePackage('@x/foreign', { exports: { '.': './dist/index.js' } })
    const p = provider('@x/foreign', base, {
      i18n: { locales: ['en'], entry: '@other/pkg/i18n', allEntry: '@other/pkg/i18n/all' },
    })

    expect(inspectI18nSubpaths([p])).toEqual([])
  })

  it('package.json с чужим name не считается своим', () => {
    // `packageBaseUrl` смотрит в dist/, а вверх по дереву первым может
    // попасться корневой манифест монорепо — судить по нему нельзя.
    const base = writePackage('@x/renamed', { exports: { '.': './dist/index.js' } })
    const p = provider('@x/not-the-same-id', base, { i18n: { locales: ['en'] } })

    expect(inspectI18nSubpaths([p])).toEqual([])
  })

  it('не-file URL пропускается', () => {
    const p = provider('@x/http', 'https://cdn.example/pkg/dist/', { i18n: { locales: ['en'] } })

    expect(inspectI18nSubpaths([p])).toEqual([])
  })

  it('провайдер без строк не проверяется вовсе', () => {
    const base = writePackage('@x/silent', { exports: { '.': './dist/index.js' } })

    expect(inspectI18nSubpaths([provider('@x/silent', base)])).toEqual([])
  })
})
