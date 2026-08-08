import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

import { defineGranularProvider } from '../contract'
import { buildRegistry } from '../core/registry'
import { collectDependencyClosure } from '../core/resolveSelection'
import { formatDoctorReport, granularDoctor } from '../doctor'
import { inspectEmittedComponentImports } from '../fs/emittedImports'
import { resolveGranularNode } from '../preset.node'

/** Раскладка собранного провайдера: `<base>/components/<Name>/<файл>`. */
function emitPackage(files: Record<string, string>): string {
  return emitPackageRaw(Object.fromEntries(
    Object.entries(files).map(([relative, content]) => [`components/${relative}`, content]),
  ))
}

/** То же, но пути задаются от КОРНЯ пакета — нужно для `groups/` и `chunks/`. */
function emitPackageRaw(files: Record<string, string>): string {
  const base = mkdtempSync(join(tmpdir(), 'granular-emitted-'))

  for (const [relative, content] of Object.entries(files)) {
    const path = join(base, relative)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content, 'utf8')
  }

  return `${pathToFileURL(base).href}/`
}

describe('collectDependencyClosure', () => {
  it('собирает транзитивные зависимости, включая корень', () => {
    const provider = defineGranularProvider({
      id: 'p',
      contractVersion: 1,
      packageBaseUrl: 'file:///p/',
      components: [
        { name: 'A', dependencies: ['B'] },
        { name: 'B', dependencies: ['C'] },
        { name: 'C' },
        { name: 'D' },
      ],
    })

    const closure = collectDependencyClosure(buildRegistry([provider]), 'p:A')

    expect([...closure].sort()).toEqual(['p:A', 'p:B', 'p:C'])
  })

  it('обрывает ветку на незарегистрированном компоненте, а не падает', () => {
    const provider = defineGranularProvider({
      id: 'p',
      contractVersion: 1,
      packageBaseUrl: 'file:///p/',
      components: [{ name: 'A', dependencies: ['Ghost', 'other:Gone'] }],
    })

    expect([...collectDependencyClosure(buildRegistry([provider]), 'p:A')].sort())
      .toEqual(['other:Gone', 'p:A', 'p:Ghost'])
  })

  it('не зацикливается на циклическом графе', () => {
    const provider = defineGranularProvider({
      id: 'p',
      contractVersion: 1,
      packageBaseUrl: 'file:///p/',
      components: [
        { name: 'A', dependencies: ['B'] },
        { name: 'B', dependencies: ['A'] },
      ],
    })

    expect([...collectDependencyClosure(buildRegistry([provider]), 'p:A')].sort()).toEqual(['p:A', 'p:B'])
  })
})

describe('inspectEmittedComponentImports', () => {
  it('находит импорт в директорию соседа и склеивает повторы в одно ребро', () => {
    const packageBaseUrl = emitPackage({
      'A/index.js': 'export * from "./chunks/a.js";\n',
      'A/chunks/a.js': 'import { x } from "../../B/chunks/b.js";\nimport { y } from "../../B/index.js";\nexport { x, y };\n',
      'B/index.js': 'export const x = 1;\n',
      'B/chunks/b.js': 'export const y = 2;\n',
    })
    const provider = defineGranularProvider({
      id: 'p',
      contractVersion: 1,
      packageBaseUrl,
      components: [{ name: 'A' }, { name: 'B' }],
    })

    const edges = inspectEmittedComponentImports(resolveGranularNode({ providers: [provider], components: 'all' }))

    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ from: 'p:A', to: 'p:B', source: join('chunks', 'a.js') })
  })

  it('не путает компонент с компонентом, чьё имя начинается так же', () => {
    const packageBaseUrl = emitPackage({
      'Card/index.js': 'import "../CardHeader/index.js";\n',
      'CardHeader/index.js': 'export const h = 1;\n',
    })
    const provider = defineGranularProvider({
      id: 'p',
      contractVersion: 1,
      packageBaseUrl,
      components: [{ name: 'Card' }, { name: 'CardHeader' }],
    })

    const edges = inspectEmittedComponentImports(resolveGranularNode({ providers: [provider], components: 'all' }))

    expect(edges.map(e => e.to)).toEqual(['p:CardHeader'])
  })

  it('видит межпакетный импорт по bare-спецификатору', () => {
    const donorBase = emitPackage({ 'Base/index.js': 'export const b = 1;\n' })
    const appBase = emitPackage({ 'Card/index.js': 'import "@donor/pkg/components/Base";\n' })

    const donor = defineGranularProvider({
      id: '@donor/pkg',
      contractVersion: 1,
      packageBaseUrl: donorBase,
      components: [{ name: 'Base' }],
    })
    const app = defineGranularProvider({
      id: 'app',
      contractVersion: 1,
      packageBaseUrl: appBase,
      components: [{ name: 'Card' }],
      dependencies: [donor],
    })

    const edges = inspectEmittedComponentImports(resolveGranularNode({ providers: [app], components: ['app:Card'] }))

    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ from: 'app:Card', to: '@donor/pkg:Base' })
  })

  it('идёт сквозь `groups/<group>/shared/`: A → shared → B это тоже ребро', () => {
    // Бандлер выносит SFC, общий для группы, в `groups/<g>/shared/`
    // (см. `granularChunkFileNames()`), и прямого импорта `A → B` в
    // `components/A/` не остаётся вовсе.
    const packageBaseUrl = emitPackageRaw({
      'components/A/index.js': 'import "../../groups/g/shared/w.js";\n',
      'components/B/index.js': 'export const b = 1;\n',
      'groups/g/shared/w.js': 'import "../../../components/B/index.js";\nexport const w = 1;\n',
    })
    const provider = defineGranularProvider({
      id: 'p',
      contractVersion: 1,
      packageBaseUrl,
      components: [{ name: 'A', group: 'g' }, { name: 'B' }],
    })

    const edges = inspectEmittedComponentImports(resolveGranularNode({ providers: [provider], components: 'all' }))

    expect(edges).toHaveLength(1)
    // `source` — файл, где импорт реально записан, относительно корня пакета.
    expect(edges[0]).toMatchObject({ from: 'p:A', to: 'p:B', source: join('groups', 'g', 'shared', 'w.js') })
  })

  it('идёт сквозь общий чанк верхнего уровня `chunks/`', () => {
    const packageBaseUrl = emitPackageRaw({
      'components/A/index.js': 'import "../../chunks/shared-a1b2.js";\n',
      'components/B/index.js': 'export const b = 1;\n',
      'chunks/shared-a1b2.js': 'import "../components/B/index.js";\nexport const s = 1;\n',
    })
    const provider = defineGranularProvider({
      id: 'p',
      contractVersion: 1,
      packageBaseUrl,
      components: [{ name: 'A' }, { name: 'B' }],
    })

    const edges = inspectEmittedComponentImports(resolveGranularNode({ providers: [provider], components: 'all' }))

    expect(edges.map(e => `${e.from} → ${e.to}`)).toEqual(['p:A → p:B'])
  })

  it('не зацикливается на взаимных импортах общих чанков', () => {
    const packageBaseUrl = emitPackageRaw({
      'components/A/index.js': 'import "../../chunks/x.js";\n',
      'chunks/x.js': 'import "./y.js";\nexport const x = 1;\n',
      'chunks/y.js': 'import "./x.js";\nexport const y = 1;\n',
    })
    const provider = defineGranularProvider({
      id: 'p',
      contractVersion: 1,
      packageBaseUrl,
      components: [{ name: 'A' }],
    })

    expect(inspectEmittedComponentImports(resolveGranularNode({ providers: [provider], components: 'all' }))).toEqual([])
  })

  it('не читает `.cjs`: `require()` этот разбор не понимает, и молчать честнее', () => {
    // Зафиксированное ограничение, а не дефект: расширение исключено из
    // `SCANNABLE`, чтобы CJS-вывод не выглядел проверенным.
    const packageBaseUrl = emitPackage({
      'A/index.cjs': 'const b = require("../B/index.cjs");\nmodule.exports = { b };\n',
      'A/index.js': 'export const a = 1;\n',
      'B/index.cjs': 'module.exports = { b: 1 };\n',
      'B/index.js': 'export const b = 1;\n',
    })
    const provider = defineGranularProvider({
      id: 'p',
      contractVersion: 1,
      packageBaseUrl,
      components: [{ name: 'A' }, { name: 'B' }],
    })

    expect(inspectEmittedComponentImports(resolveGranularNode({ providers: [provider], components: 'all' }))).toEqual([])
  })

  it('bare-спецификатор: имя компонента берётся только из своей позиции', () => {
    const donorBase = emitPackageRaw({
      'components/Button/index.js': 'export const b = 1;\n',
      'components/Modal/index.js': 'export const m = 1;\n',
      'utils/Button/format.js': 'export const f = 1;\n',
    })
    // `utils/Button/` — не компонент; `Modal/Button/` содержит два имени сразу.
    const appBase = emitPackage({
      'Card/index.js': 'import "@donor/pkg/utils/Button/format.js";\nimport "@donor/pkg/Modal/Button/x.js";\n',
    })

    const donor = defineGranularProvider({
      id: '@donor/pkg',
      contractVersion: 1,
      packageBaseUrl: donorBase,
      components: [{ name: 'Button' }, { name: 'Modal' }],
    })
    const app = defineGranularProvider({
      id: 'app',
      contractVersion: 1,
      packageBaseUrl: appBase,
      components: [{ name: 'Card' }],
      dependencies: [donor],
    })

    const edges = inspectEmittedComponentImports(resolveGranularNode({ providers: [app], components: 'all' }))

    // `utils/Button/format.js` — не ребро вовсе; `Modal/Button/x.js` — ребро
    // на `Modal` (первый сегмент), и оно не зависит от порядка `components`.
    expect(edges.map(e => e.to)).toEqual(['@donor/pkg:Modal'])
  })

  it('не читает sourcemap: инлайн-исходники дали бы импорты, которых в бандле нет', () => {
    const packageBaseUrl = emitPackage({
      'A/index.js': 'export const a = 1;\n',
      'A/index.js.map': JSON.stringify({ sourcesContent: ['import "../../B/index.js"'] }),
      'B/index.js': 'export const b = 1;\n',
    })
    const provider = defineGranularProvider({
      id: 'p',
      contractVersion: 1,
      packageBaseUrl,
      components: [{ name: 'A' }, { name: 'B' }],
    })

    expect(inspectEmittedComponentImports(resolveGranularNode({ providers: [provider], components: 'all' }))).toEqual([])
  })
})

describe('диагностика undeclared-dependency', () => {
  /** `A` рендерит `B`, но `dependencies` про это не знают — исходный дефект. */
  function undeclaredFixture(dependencies?: readonly string[]) {
    const packageBaseUrl = emitPackage({
      'A/index.js': 'import "../B/index.js";\nexport const a = 1;\n',
      'B/index.js': 'export const b = 1;\n',
    })
    return defineGranularProvider({
      id: 'p',
      contractVersion: 1,
      packageBaseUrl,
      components: [
        { name: 'A', safelist: ['a-1'], ...(dependencies ? { dependencies } : {}) },
        { name: 'B', safelist: ['b-1'] },
      ],
    })
  }

  it('ловит импорт, не покрытый графом, и объясняет последствие', () => {
    const report = granularDoctor({ providers: [undeclaredFixture()], components: ['p:A'] })

    expect(report.undeclaredDependencies).toHaveLength(1)
    expect(report.undeclaredDependencies[0]).toMatchObject({ from: 'p:A', to: 'p:B' })

    const diagnostic = report.diagnostics.find(d => d.code === 'undeclared-dependency')
    expect(diagnostic).toMatchObject({ level: 'warn', subject: 'p:A' })
    expect(diagnostic!.message).toContain('p:B')

    // Уровень `warn`: сборка не падает, но `--strict` в CI — падает.
    expect(report.ok).toBe(true)
    expect(report.clean).toBe(false)
  })

  it('молчит, когда зависимость объявлена', () => {
    const report = granularDoctor({ providers: [undeclaredFixture(['B'])], components: ['p:A'] })

    expect(report.undeclaredDependencies).toEqual([])
    expect(report.diagnostics.some(d => d.code === 'undeclared-dependency')).toBe(false)
  })

  it('молчит на транзитивно достижимом: граф разворачивает пресет', () => {
    const packageBaseUrl = emitPackage({
      'A/index.js': 'import "../C/index.js";\n',
      'B/index.js': 'export const b = 1;\n',
      'C/index.js': 'export const c = 1;\n',
    })
    const provider = defineGranularProvider({
      id: 'p',
      contractVersion: 1,
      packageBaseUrl,
      components: [
        { name: 'A', dependencies: ['B'] },
        { name: 'B', dependencies: ['C'] },
        { name: 'C' },
      ],
    })

    expect(granularDoctor({ providers: [provider], components: ['p:A'] }).undeclaredDependencies).toEqual([])
  })

  it('находит нарушение и при `components: "all"`, когда цель выбрана по другой причине', () => {
    // Здесь CSS этой конкретной сборки верен — `B` в скане. Но `dependencies`
    // всё равно врут, и потребитель, выбравший `A` отдельно, получит `B` без
    // классов. Молчать тут значило бы не ловить дефект никогда: `all` —
    // самая частая конфигурация.
    const report = granularDoctor({ providers: [undeclaredFixture()], components: 'all' })

    expect(report.undeclaredDependencies.map(e => `${e.from} → ${e.to}`)).toEqual(['p:A → p:B'])
  })

  it('печатает секцию в текстовом отчёте', () => {
    const text = formatDoctorReport(granularDoctor({ providers: [undeclaredFixture()], components: ['p:A'] }))

    expect(text).toContain('Undeclared dependencies (1)')
    expect(text).toContain('p:A → p:B')
  })
})
