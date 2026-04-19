import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  parseCssCustomPropertyBlocks,
  parseCssCustomPropertyBlocksSync,
  tokenDefinitionsFromCss,
  tokenDefinitionsFromCssSync,
} from '../node-utils/tokenDefinitionsFromCss'

const ROOT_CSS = `
:root {
  --brd: #e2e8f0;
  --card: #ffffff;
  --card-fg: #0f172a;
}
`

const MULTI_BLOCKS_CSS = `
/* comment with { curly } inside */
:root {
  --brd: #e2e8f0;
}

.dark, [data-theme="dark"] {
  --brd: #334155;
  --accent: var(--brand, blue);
}
`

const EMPTY_CSS = `
/* no custom properties here */
.foo { color: red; }
`

function toDataUrl(css: string): string {
  return `data:text/css,${encodeURIComponent(css)}`
}

describe('tokenDefinitionsFromCss (data URLs)', () => {
  it('parses :root from data URL', async () => {
    const result = await tokenDefinitionsFromCss(toDataUrl(ROOT_CSS))
    expect(result).toEqual({
      selector: ':root',
      tokens: {
        'brd': '#e2e8f0',
        'card': '#ffffff',
        'card-fg': '#0f172a',
      },
    })
  })

  it('sync variant returns same result', () => {
    const result = tokenDefinitionsFromCssSync(toDataUrl(ROOT_CSS))
    expect(result.selector).toBe(':root')
    expect(result.tokens.brd).toBe('#e2e8f0')
  })

  it('respects `as` to override the resulting selector', async () => {
    const result = await tokenDefinitionsFromCss(toDataUrl(ROOT_CSS), { as: '.dark' })
    expect(result.selector).toBe('.dark')
    expect(result.tokens.brd).toBe('#e2e8f0')
  })

  it('picks the block matching the requested selector when multiple exist', async () => {
    const result = await tokenDefinitionsFromCss(toDataUrl(MULTI_BLOCKS_CSS), {
      selector: '.dark, [data-theme="dark"]',
    })
    expect(result.selector).toBe('.dark, [data-theme="dark"]')
    expect(result.tokens.brd).toBe('#334155')
    expect(result.tokens.accent).toBe('var(--brand, blue)')
  })

  it('throws in strict mode when the requested selector is not found', async () => {
    await expect(
      tokenDefinitionsFromCss(toDataUrl(MULTI_BLOCKS_CSS), { selector: '.unknown' }),
    ).rejects.toThrow(/selector ".unknown" not found/)
  })

  it('falls back to the first block in non-strict mode', async () => {
    const result = await tokenDefinitionsFromCss(toDataUrl(MULTI_BLOCKS_CSS), {
      selector: '.unknown',
      strict: false,
    })
    expect(result.selector).toBe(':root')
    expect(result.tokens.brd).toBe('#e2e8f0')
  })

  it('throws in strict mode when no custom properties are present', async () => {
    await expect(
      tokenDefinitionsFromCss(toDataUrl(EMPTY_CSS)),
    ).rejects.toThrow(/no CSS custom properties/)
  })

  it('returns empty tokens in non-strict mode when nothing is found', async () => {
    const result = await tokenDefinitionsFromCss(toDataUrl(EMPTY_CSS), { strict: false })
    expect(result).toEqual({ selector: ':root', tokens: {} })
  })
})

describe('tokenDefinitionsFromCss (file URLs)', () => {
  let dir: string
  let lightPath: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'granular-tokens-'))
    lightPath = join(dir, 'light.css')
    writeFileSync(lightPath, ROOT_CSS, 'utf8')
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads file by absolute path', async () => {
    const result = await tokenDefinitionsFromCss(lightPath)
    expect(result.tokens.card).toBe('#ffffff')
  })

  it('reads file by file:// URL (async & sync)', async () => {
    const url = pathToFileURL(lightPath).href
    const asyncResult = await tokenDefinitionsFromCss(url)
    const syncResult = tokenDefinitionsFromCssSync(url)
    expect(asyncResult).toEqual(syncResult)
    expect(asyncResult.tokens['card-fg']).toBe('#0f172a')
  })
})

const DARK_COMPOUND_CSS = `
.theme-dark,
.dark,
[data-theme='dark'] {
    --card: #1e293b;
    --card-fg: #f8fafc;
    --brd: #334155;
}
`

describe('tokenDefinitionsFromCss (compound multi-line selector)', () => {
  // Реальный кейс: packages/simple-package/src/styles/themes/dark.css —
  // один блок с тремя селекторами, разнесёнными по строкам.
  const EXPECTED_SELECTOR = `.theme-dark, .dark, [data-theme='dark']`
  const EXPECTED_TOKENS = {
    'card': '#1e293b',
    'card-fg': '#f8fafc',
    'brd': '#334155',
  }

  it('нормализует multi-line compound selector в одну строку', async () => {
    const blocks = await parseCssCustomPropertyBlocks(toDataUrl(DARK_COMPOUND_CSS))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].selector).toBe(EXPECTED_SELECTOR)
    expect(blocks[0].tokens).toEqual(EXPECTED_TOKENS)
  })

  it('подхватывает единственный блок с compound selector без опций (single-block fallback)', async () => {
    const result = await tokenDefinitionsFromCss(toDataUrl(DARK_COMPOUND_CSS))
    // При `selector: ':root'` (по умолчанию) точного совпадения нет, но блок один — берём его.
    expect(result.selector).toBe(EXPECTED_SELECTOR)
    expect(result.tokens).toEqual(EXPECTED_TOKENS)
  })

  it('точное совпадение compound selector + override через `as`', async () => {
    const result = await tokenDefinitionsFromCss(toDataUrl(DARK_COMPOUND_CSS), {
      selector: EXPECTED_SELECTOR,
      as: '.dark, [data-theme="dark"]',
    })
    expect(result.selector).toBe('.dark, [data-theme="dark"]')
    expect(result.tokens).toEqual(EXPECTED_TOKENS)
  })

  it('эмулирует реальное использование: tokenDefinitionsFromCssSync с `as`', () => {
    // Повторяет вызов из packages/simple-package/src/granular-provider/index.ts
    const result = tokenDefinitionsFromCssSync(toDataUrl(DARK_COMPOUND_CSS), {
      as: '.dark, [data-theme="dark"]',
    })
    expect(result.selector).toBe('.dark, [data-theme="dark"]')
    expect(result.tokens.brd).toBe('#334155')
    expect(result.tokens.card).toBe('#1e293b')
    expect(result.tokens['card-fg']).toBe('#f8fafc')
  })
})

describe('parseCssCustomPropertyBlocks', () => {
  it('returns all blocks in document order', async () => {
    const blocks = await parseCssCustomPropertyBlocks(toDataUrl(MULTI_BLOCKS_CSS))
    expect(blocks.map(b => b.selector)).toEqual([
      ':root',
      '.dark, [data-theme="dark"]',
    ])
    expect(blocks[1].tokens.accent).toBe('var(--brand, blue)')
  })

  it('accepts raw CSS literals', () => {
    const blocks = parseCssCustomPropertyBlocksSync(MULTI_BLOCKS_CSS)
    expect(blocks).toHaveLength(2)
  })

  it('skips blocks without custom properties', () => {
    const blocks = parseCssCustomPropertyBlocksSync(`
      .foo { color: red; }
      :root { --a: 1; }
    `)
    expect(blocks).toEqual([{ selector: ':root', tokens: { a: '1' } }])
  })
})
