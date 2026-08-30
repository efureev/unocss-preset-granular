import type { GranularProvider } from '../contract'
import type { PresetGranularNodeOptions } from '../preset.node'

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getGranularNodeCss } from '../preset.node'

let root: string
let baseUrl: string

function provider(dynamicTokens?: readonly string[]): GranularProvider {
  return {
    id: 'pkg',
    contractVersion: 1,
    packageBaseUrl: baseUrl,
    components: [{
      name: 'A',
      safelist: ['bg-[var(--used)]'],
      cssFiles: [new URL('own.css', baseUrl).href],
      cssFileAssetNames: ['own.css'],
      // Объявление живёт НА КОМПОНЕНТЕ: провайдерский список держал бы токен
      // и в сборках, где этого компонента нет.
      ...(dynamicTokens ? { dynamicTokens } : {}),
    }],
    theme: {
      tokensCssUrl: new URL('tokens.css', baseUrl).href,
      baseCssUrl: new URL('base.css', baseUrl).href,
      themes: {
        light: new URL('light.css', baseUrl).href,
        dark: new URL('dark.css', baseUrl).href,
      },
    },
  }
}

function options(prune?: PresetGranularNodeOptions['pruneTokens'], dynamicTokens?: readonly string[]): PresetGranularNodeOptions {
  return {
    providers: [provider(dynamicTokens)],
    components: 'all',
    themes: { names: ['light', 'dark'] },
    ...(prune ? { pruneTokens: prune } : {}),
  }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'granular-prune-'))
  baseUrl = pathToFileURL(`${root}/`).href

  mkdirSync(join(root, 'components', 'A'), { recursive: true })
  writeFileSync(join(root, 'components', 'A', 'index.js'), 'export default 1\n', 'utf8')

  writeFileSync(join(root, 'tokens.css'), [
    ':root {',
    '  --used: #111;',
    '  --unused: #222;',
    '  --derived: color-mix(in oklab, var(--chained) 50%, white);',
    '  --chained: #333;',
    '  --z-dyn: 1000;',
    '  --from-base: 4px;',
    '  --from-own-css: 8px;',
    '  --overridden: #444;',
    '}',
    '',
  ].join('\n'), 'utf8')

  // Правила, а не объявления: файл не обрезается, а его `var()` — корни.
  writeFileSync(join(root, 'base.css'), 'body { margin: var(--from-base) }\n', 'utf8')
  // Объявленный `cssFiles` компонента — тоже корни, и сам он не обрезается.
  // `--only-dark` потребляется ИМЕННО отсюда: без потребителя он мёртв и
  // честно удаляется вместе со своей парой, и проверять глобальность
  // множества стало бы не на чем.
  writeFileSync(
    join(root, 'own.css'),
    '.a { padding: var(--from-own-css) }\n.b { color: var(--only-dark) }\n',
    'utf8',
  )

  // `--derived` потребляется разметкой компонента, поэтому тянет `--chained`.
  writeFileSync(join(root, 'components', 'A', 'tpl.js'), 'export const c = "shadow-[var(--derived)]"\n', 'utf8')

  writeFileSync(join(root, 'light.css'), [
    ':root {',
    '  --only-light: #aaa;',
    '  --unused-light: #bbb;',
    '  --derived: color-mix(in oklab, var(--chained) 50%, white);',
    '}',
    '@supports not (color: color-mix(in oklab, red, blue)) {',
    '  :root {',
    '    --derived: #cdcdcd;',
    '    --unused-light: #dddddd;',
    '  }',
    '}',
    '',
  ].join('\n'), 'utf8')

  writeFileSync(join(root, 'dark.css'), [
    '[data-theme=\'dark\'] {',
    // Объявлен только в тёмной, ссылается на объявленный только в светлой.
    '  --only-dark: var(--only-light);',
    '  --unused-dark: #eee;',
    '}',
    '',
  ].join('\n'), 'utf8')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('pruneTokens: выключенная обрезка не меняет ничего', () => {
  it('отсутствие опции и mode:off дают побайтово одинаковый CSS', async () => {
    const withoutOption = await getGranularNodeCss(options())
    const explicitlyOff = await getGranularNodeCss(options({ mode: 'off' }))
    expect(explicitlyOff).toBe(withoutOption)
  })

  it('mode:report тоже не трогает эмиссию', async () => {
    // Отчётный режим существует ровно ради этого: посмотреть список
    // удаляемого, ничем не рискуя.
    expect(await getGranularNodeCss(options({ mode: 'report' })))
      .toBe(await getGranularNodeCss(options()))
  })
})

describe('pruneTokens: что удаляется', () => {
  it('неиспользуемые токены уходят из tokens.css и из файлов тем', async () => {
    const css = await getGranularNodeCss(options({ mode: 'on' }))
    expect(css).not.toContain('--unused:')
    expect(css).not.toContain('--unused-light:')
    expect(css).not.toContain('--unused-dark:')
  })

  it('опустевший @supports уходит вместе со скорлупой', async () => {
    // В fallback-блоке было два объявления; `--derived` уцелеет, поэтому блок
    // остаётся — но без `--unused-light`.
    const css = await getGranularNodeCss(options({ mode: 'on' }))
    expect(css).toContain('@supports not')
    expect(css).not.toMatch(/--unused-light:\s*#dddddd/)
  })
})

describe('pruneTokens: что обязано уцелеть', () => {
  it('токен из safelist компонента', async () => {
    expect(await getGranularNodeCss(options({ mode: 'on' }))).toContain('--used:')
  })

  it('токен, до которого дотягивается замыкание по значению', async () => {
    // `--derived` потребляется разметкой, его значение ссылается на
    // `--chained` — тот не потребляется никем напрямую.
    expect(await getGranularNodeCss(options({ mode: 'on' }))).toContain('--chained:')
  })

  it('обе записи производного токена: и формула, и фолбэк внутри at-rule', async () => {
    const css = await getGranularNodeCss(options({ mode: 'on' }))
    expect(css).toContain('--derived: color-mix')
    expect(css).toContain('--derived: #cdcdcd')
  })

  it('токен светлой темы, на который смотрит только тёмная', async () => {
    // Множество сохранённых ГЛОБАЛЬНО по темам. Посчитанное потемно, оно
    // выкинуло бы `--only-light` (в светлой на него никто не смотрит) и
    // оставило бы `--only-dark` ссылаться в пустоту.
    const css = await getGranularNodeCss(options({ mode: 'on' }))
    expect(css).toContain('--only-light:')
    expect(css).toContain('--only-dark:')
  })

  it('токен, потребляемый правилами base.css', async () => {
    expect(await getGranularNodeCss(options({ mode: 'on' }))).toContain('--from-base:')
  })

  it('токен, потребляемый объявленным cssFiles компонента', async () => {
    expect(await getGranularNodeCss(options({ mode: 'on' }))).toContain('--from-own-css:')
  })

  it('токен, на который написан tokenOverrides приложения', async () => {
    const css = await getGranularNodeCss({
      ...options({ mode: 'on' }),
      themes: { names: ['light', 'dark'], tokenOverrides: { light: { overridden: '#999' } } },
    })
    expect(css).toContain('--overridden')
  })
})

describe('pruneTokens: escape-hatch’и', () => {
  it('keep по точному имени', async () => {
    expect(await getGranularNodeCss(options({ mode: 'on', keep: ['unused'] }))).toContain('--unused:')
  })

  it('keep по шаблону со звёздочкой', async () => {
    expect(await getGranularNodeCss(options({ mode: 'on', keep: ['unused*'] }))).toContain('--unused-light:')
  })

  it('keepPrefixes', async () => {
    expect(await getGranularNodeCss(options({ mode: 'on', keepPrefixes: ['unused'] }))).toContain('--unused-dark:')
  })

  it('dynamicTokens компонента — знание автора компонента, а не приложения', async () => {
    // `--z-dyn` не потребляется ничем статически: имя собирается в рантайме.
    const off = await getGranularNodeCss(options({ mode: 'on' }))
    expect(off).not.toContain('--z-dyn:')

    const on = await getGranularNodeCss(options({ mode: 'on' }, ['z-*']))
    expect(on).toContain('--z-dyn:')
  })
})

describe('pruneTokens: что не обрезается никогда', () => {
  it('base.css — там правила, а не объявления', async () => {
    expect(await getGranularNodeCss(options({ mode: 'on' }))).toContain('body { margin: var(--from-base) }')
  })

  it('компонентный CSS — он уже селективен по выбору компонентов', async () => {
    expect(await getGranularNodeCss(options({ mode: 'on' }))).toContain('.a { padding: var(--from-own-css) }')
    expect(await getGranularNodeCss(options({ mode: 'on' }))).toContain('.b { color: var(--only-dark) }')
  })
})
