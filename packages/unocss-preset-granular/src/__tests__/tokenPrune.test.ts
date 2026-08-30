import type { GranularProvider } from '../contract'
import type { PresetGranularNodeOptions } from '../preset.node'

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { inspectGranularAppTokenUsage, planGranularTokenPrune } from '../node-utils/tokenPrune'
import { inspectGranularScanDirs, resolveGranularNode } from '../preset.node'

let root: string
let baseUrl: string
let appDir: string

function provider(): GranularProvider {
  return {
    id: 'pkg',
    contractVersion: 1,
    packageBaseUrl: baseUrl,
    components: [
      { name: 'A', safelist: ['bg-[var(--seed)]'] },
      // Второй компонент — с объявлением. В селекцию `components: 'all'`
      // входит, поэтому его токен держится; тест на селективность ниже
      // выбирает только `A` и проверяет, что тогда НЕ держится.
      { name: 'B', dynamicTokens: ['by-pattern'] },
    ],
    theme: { tokensCssUrl: new URL('tokens.css', baseUrl).href },
  }
}

const TOKENS_CSS = [
  ':root {',
  '  --seed: #111;',
  '  --chain-a: var(--chain-b);',
  '  --chain-b: var(--chain-a);',
  '  --lonely: #222;',
  '  --by-pattern: #333;',
  '  --by-app: #444;',
  '  --by-override: #555;',
  '}',
  '',
].join('\n')

function plan(options: PresetGranularNodeOptions) {
  const resolution = resolveGranularNode(options)
  return planGranularTokenPrune(
    options,
    resolution,
    inspectGranularScanDirs(options).dirs,
    { inlined: [{ source: { url: 'x', kind: 'tokens', origin: 'test', owner: 'provider' }, css: TOKENS_CSS }], componentCss: [] },
  )
}

function options(extra: Partial<PresetGranularNodeOptions> = {}): PresetGranularNodeOptions {
  return { providers: [provider()], components: 'all', ...extra }
}

/** План, где среди секций есть `base` — файл, который не обрезается. */
function planWithBase(pruneTokens: PresetGranularNodeOptions['pruneTokens']) {
  const opts = options({ pruneTokens })
  const resolution = resolveGranularNode(opts)
  return planGranularTokenPrune(opts, resolution, inspectGranularScanDirs(opts).dirs, {
    inlined: [
      { source: { url: 'x', kind: 'tokens', origin: 'test', owner: 'provider' }, css: TOKENS_CSS },
      { source: { url: 'b', kind: 'base', origin: 'test', owner: 'provider' }, css: ':root { --from-base: 4px }' },
    ],
    componentCss: [],
  })
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'granular-plan-'))
  baseUrl = pathToFileURL(`${root}/`).href
  for (const name of ['A', 'B']) {
    mkdirSync(join(root, 'components', name), { recursive: true })
    writeFileSync(join(root, 'components', name, 'index.js'), 'export default 1\n', 'utf8')
  }
  writeFileSync(join(root, 'tokens.css'), TOKENS_CSS, 'utf8')

  appDir = join(root, 'app-src')
  mkdirSync(appDir, { recursive: true })
  writeFileSync(join(appDir, 'App.vue'), '<div class="bg-[var(--by-app)]" />\n', 'utf8')
  writeFileSync(join(appDir, 'skip.md'), 'var(--not-scanned)\n', 'utf8')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('planGranularTokenPrune: корни', () => {
  it('потребление компонента даёт корень', () => {
    expect(plan(options()).kept.get('seed')?.kind).toBe('usage')
  })

  it('токен, которого не потребляет никто, попадает в removable', () => {
    expect(plan(options()).removable).toContain('lonely')
  })

  it('ключи tokenOverrides — корни независимо от strictTokens', () => {
    // «Приложение написало значение» — самостоятельный факт. Отброшенный
    // strictTokens override и так репортит doctor.
    const p = plan(options({ themes: { strictTokens: true, tokenOverrides: { light: { 'by-override': '#0f0' } } } }))
    expect(p.kept.get('by-override')?.kind).toBe('override')
  })

  it('вложенная форма tokenOverrides тоже даёт корни', () => {
    const p = plan(options({ themes: { tokenOverrides: { light: { '.dark': { 'by-override': '#0f0' } } } } }))
    expect(p.kept.has('by-override')).toBe(true)
  })
})

describe('planGranularTokenPrune: dynamicTokens объявляет КОМПОНЕНТ', () => {
  it('объявление выбранного компонента держит токен', () => {
    expect(plan(options()).kept.get('by-pattern')?.kind).toBe('keep-pattern')
  })

  it('в причине названы провайдер и компонент — видно, кто держит', () => {
    const reason = plan(options()).kept.get('by-pattern')
    expect(reason?.kind === 'keep-pattern' && reason.pattern).toContain('pkg:B')
  })

  it('не выбранный компонент своим объявлением ничего не держит', () => {
    // Ровно та разница, ради которой поле переехало с провайдера на компонент:
    // провайдерский список держал бы токен и здесь, в сборке без `B`.
    const onlyA = options({ components: [{ provider: 'pkg', names: ['A'] }] })
    expect(plan(onlyA).kept.has('by-pattern')).toBe(false)
    expect(plan(onlyA).removable).toContain('by-pattern')
  })
})

describe('planGranularTokenPrune: escape-hatch’и', () => {
  it('keep строкой по точному имени', () => {
    expect(plan(options({ pruneTokens: { mode: 'on', keep: ['lonely'] } })).kept.get('lonely')?.kind).toBe('keep-pattern')
  })

  it('keep шаблоном со звёздочкой', () => {
    expect(plan(options({ pruneTokens: { mode: 'on', keep: ['by-*'] } })).removable).not.toContain('by-pattern')
  })

  it('keep регулярным выражением', () => {
    expect(plan(options({ pruneTokens: { mode: 'on', keep: [/^lone/] } })).removable).not.toContain('lonely')
  })

  it('keepPrefixes', () => {
    expect(plan(options({ pruneTokens: { mode: 'on', keepPrefixes: ['by-'] } })).removable).not.toContain('by-pattern')
  })
})

describe('planGranularTokenPrune: мёртвые шаблоны', () => {
  it('шаблон, не совпавший ни с одним объявленным токеном, попадает в deadPatterns', () => {
    // Опечатка либо строка, оставшаяся после того, как компонент перестал
    // собирать имя в рантайме. Само по себе ничего не ломает — потому и
    // гниёт молча.
    expect(plan(options({ pruneTokens: { mode: 'on', keep: ['xh-typo-*'] } })).deadPatterns)
      .toEqual(['xh-typo-*'])
  })

  it('совпавший шаблон мёртвым не считается', () => {
    expect(plan(options({ pruneTokens: { mode: 'on', keep: ['lonely'] } })).deadPatterns).toEqual([])
  })

  it('второй шаблон, покрывающий тот же токен, тоже считается живым', () => {
    // Наивный `patterns.find` пометил бы живым только первый.
    const p = plan(options({ pruneTokens: { mode: 'on', keep: ['lonely', 'lone*'] } }))
    expect(p.deadPatterns).toEqual([])
  })

  it('шаблон на токен из base мёртвым не считается', () => {
    // `base` не обрезается, удерживать там нечего — но шаблон, целящийся в
    // его токен, написан осмысленно и ложной находкой быть не должен.
    const withBase = planWithBase({ mode: 'on', keep: ['from-base'] })
    expect(withBase.deadPatterns).toEqual([])
  })

  it('объявление невыбранного компонента мёртвым НЕ считается', () => {
    // Оно просто не применилось к этой сборке. Ругаться на автора пакета за
    // то, что приложение не взяло его компонент, — вранье.
    const onlyA = options({ components: [{ provider: 'pkg', names: ['A'] }] })
    expect(plan(onlyA).deadPatterns).toEqual([])
  })
})

describe('planGranularTokenPrune: замыкание', () => {
  it('взаимная ссылка не зацикливает', () => {
    // `--chain-a: var(--chain-b); --chain-b: var(--chain-a)` — обход обязан
    // сойтись по множеству, а не переполнить стек.
    const p = plan(options({ pruneTokens: { mode: 'on', keep: ['chain-a'] } }))
    expect(p.kept.has('chain-b')).toBe(true)
    expect(p.kept.get('chain-b')?.kind).toBe('referenced-by')
  })
})

describe('inspectGranularAppTokenUsage', () => {
  it('без настройки не читает ни одного файла', () => {
    const usage = inspectGranularAppTokenUsage(options())
    expect(usage.files).toBe(0)
    expect(usage.tokens.size).toBe(0)
  })

  it('находит токен в разметке приложения и делает его корнем', () => {
    const opts = options({ pruneTokens: { mode: 'on', appSources: { dirs: [appDir] } } })
    expect(inspectGranularAppTokenUsage(opts).tokens.has('by-app')).toBe(true)
    expect(plan(opts).kept.get('by-app')?.kind).toBe('app-source')
  })

  it('расширения вне списка не читаются', () => {
    const opts = options({ pruneTokens: { mode: 'on', appSources: { dirs: [appDir] } } })
    expect(inspectGranularAppTokenUsage(opts).tokens.has('not-scanned')).toBe(false)
  })

  it('несуществующая директория не роняет сборку', () => {
    // Это конфигурация приложения; её отсутствие видно по `files: 0`.
    const opts = options({ pruneTokens: { mode: 'on', appSources: { dirs: [join(root, 'нет-такой')] } } })
    expect(inspectGranularAppTokenUsage(opts).files).toBe(0)
  })

  it('мемоизируется по идентичности options', () => {
    const opts = options({ pruneTokens: { mode: 'on', appSources: { dirs: [appDir] } } })
    expect(inspectGranularAppTokenUsage(opts)).toBe(inspectGranularAppTokenUsage(opts))
  })
})
