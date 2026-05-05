/**
 * Интеграционный тест: «жёсткий контракт layout провайдера + рекурсивный
 * скан подпапок компонента + извлечение классов UnoCSS из скомпилированных
 * чанков». Эмулирует прод-сборку granular-провайдера: один пакет с
 * единственным компонентом, у которого есть подпапка `chunks/`.
 *
 * Цель — гарантировать, что **классы из вложенных подпапок попадают в
 * итоговый CSS** через `granularContent.filesystem` (это и есть ровно тот
 * сценарий, который ломался при использовании удалённой опции `sourceDir`).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import presetMini from '@unocss/preset-mini'
import { createGenerator } from 'unocss'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { defineGranularComponent, defineGranularProvider } from '../contract'
import { granularContent } from '../preset.node'

interface PackageLayout {
  pkgRoot: string
  componentDir: string
}

function writeFakePackage(root: string): PackageLayout {
  const pkgRoot = join(root, 'pkg/dist')
  const componentDir = join(pkgRoot, 'components/XNested')
  const chunksDir = join(componentDir, 'chunks')
  mkdirSync(chunksDir, { recursive: true })

  // Компонент-корень (имитация скомпилированного `XNested.vue` после vite).
  writeFileSync(
    join(componentDir, 'index.js'),
    [
      'export const __classes_root = "p-6 rounded-3xl"',
      'export { default as h } from "./chunks/XNestedHeader-abc.js"',
      'export { default as f } from "./chunks/XNestedFooter-def.js"',
    ].join('\n'),
    'utf8',
  )

  // Вложенные «чанки» с уникальными классами — именно это страдало раньше,
  // когда резолвер выбирал не ту директорию.
  writeFileSync(
    join(chunksDir, 'XNestedHeader-abc.js'),
    'export default { class: "text-7xl font-bold" }\n',
    'utf8',
  )
  writeFileSync(
    join(chunksDir, 'XNestedFooter-def.js'),
    'export default { class: "tracking-widest uppercase" }\n',
    'utf8',
  )

  return { pkgRoot, componentDir }
}

/** Минимальный glob-матчер для шаблона `<dir>/**\/*.{ext1,ext2,...}`. */
function readGlobFiles(globs: readonly string[]): { id: string, code: string }[] {
  const out: { id: string, code: string }[] = []
  for (const g of globs) {
    const m = g.match(/^(.*)\/\*\*\/\*\.\{([^}]+)\}$/)
    if (!m)
      continue
    const [, base, extsCsv] = m
    const exts = new Set(extsCsv.split(',').map(s => s.trim()))
    walk(base, out, exts)
  }
  return out
}

function walk(dir: string, acc: { id: string, code: string }[], exts: Set<string>): void {
  // eslint-disable-next-line ts/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs')
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, acc, exts)
      continue
    }
    const ext = entry.name.slice(entry.name.lastIndexOf('.') + 1)
    if (!exts.has(ext))
      continue
    acc.push({ id: full, code: readFileSync(full, 'utf8') })
  }
}

describe('granularContent e2e: рекурсивный скан вложенных подпапок', () => {
  let root: string
  let layout: PackageLayout

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'granular-e2e-'))
    layout = writeFakePackage(root)
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('классы из chunks/ собираются в итоговый CSS UnoCSS', async () => {
    const xNested = defineGranularComponent(
      pathToFileURL(join(layout.componentDir, 'config.ts')).href,
      { name: 'XNested', safelist: [] },
    )
    const provider = defineGranularProvider({
      id: 'pkg-fake',
      contractVersion: 1,
      packageBaseUrl: pathToFileURL(`${layout.pkgRoot}/`).href,
      components: [xNested],
    })

    const content = granularContent({
      providers: [provider],
      components: 'all',
    })

    // Пресет должен отдавать ровно один filesystem-glob, рекурсивный.
    expect(content.filesystem).toHaveLength(1)
    expect(content.filesystem[0]).toMatch(/components\/XNested\/\*\*\/\*\.\{/)

    // Файлы по этому glob должны включать и index.js, и оба chunks/*.js.
    const files = readGlobFiles(content.filesystem)
    const names = files.map(f => f.id.split('/').pop()).sort()
    expect(names).toEqual(['XNestedFooter-def.js', 'XNestedHeader-abc.js', 'index.js'])

    // Прогоняем через UnoCSS — все классы из подпапок должны оказаться в CSS.
    const generator = await createGenerator({ presets: [presetMini()] })
    const allCode = files.map(f => f.code).join('\n')
    const { css } = await generator.generate(allCode, { preflights: false })

    expect(css).toContain('.text-7xl')
    expect(css).toContain('.tracking-widest')
    expect(css).toContain('.rounded-3xl')
    expect(css).toContain('.p-6')
    expect(css).toContain('.font-bold')
  })
})
