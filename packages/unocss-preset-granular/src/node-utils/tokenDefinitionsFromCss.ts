import type { GranularThemeTokenSet } from '../contract'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { isCssDataUrl, readCss, resolveCssFilePath } from '../fs/readCss'

/** Результат парсинга одного CSS-блока с custom properties. */
export interface ParsedTokenBlock {
  /** Селектор блока (`:root`, `.dark`, `[data-theme="hc"]`, ...). */
  selector: string
  /** Карта токенов БЕЗ префикса `--` (совместима с `GranularThemeTokenSet.tokens`). */
  tokens: Record<string, string>
}

export interface TokenDefinitionsFromCssOptions {
  /**
   * Какой селектор извлекать из файла. По умолчанию `:root`.
   *
   * Используется ровное сравнение с нормализованной (trim + схлопнутые
   * пробелы) строкой селектора блока. Если такого блока нет, но в файле
   * есть ровно один блок с custom properties — будет взят он.
   */
  selector?: string
  /**
   * Переопределить селектор в результате (например, забрать значения
   * из блока `:root` в исходном файле, но поместить их под `.dark`).
   */
  as?: string
  /**
   * Строгий режим: бросать ошибку, если в файле не найдено ни одного
   * блока с custom properties, либо если запрошенный `selector` не
   * найден и определить его однозначно нельзя. По умолчанию `true`.
   */
  strict?: boolean
}

const DEFAULT_SELECTOR = ':root'

/**
 * Асинхронный хелпер для авторов granular-провайдеров.
 *
 * Парсит CSS‑файл темы (путь, `file://`‑URL или `data:text/css,...`),
 * извлекает блок с CSS custom properties и возвращает готовую запись
 * для `GranularThemeContribution.tokenDefinitions[name]`.
 *
 * ВАЖНО: предназначен для использования строго в node‑entry провайдера
 * (`<pkg>/granular-provider/node.ts`). В браузере использовать нельзя
 * (требуется FS).
 *
 * @example
 * ```ts
 * import { tokenDefinitionsFromCss } from '@feugene/unocss-preset-granular/node'
 *
 * const light = await tokenDefinitionsFromCss(
 *   new URL('../styles/themes/light.css', import.meta.url).href,
 *   { selector: ':root' },
 * )
 * // → { selector: ':root', tokens: { brd: '#e2e8f0', card: '#ffffff', ... } }
 * ```
 */
export async function tokenDefinitionsFromCss(
  source: string,
  options: TokenDefinitionsFromCssOptions = {},
): Promise<GranularThemeTokenSet> {
  const css = await readCss(isCssDataUrl(source) ? source : resolveCssFilePath(source))
  return parseAndPick(css, source, options)
}

/**
 * Синхронный аналог `tokenDefinitionsFromCss`.
 *
 * Удобен для использования на верхнем уровне модуля (вычисление
 * `tokenDefinitions` при импорте `granular-provider/node.ts`).
 */
export function tokenDefinitionsFromCssSync(
  source: string,
  options: TokenDefinitionsFromCssOptions = {},
): GranularThemeTokenSet {
  const css = readCssSync(source)
  return parseAndPick(css, source, options)
}

/**
 * Извлекает ВСЕ блоки с CSS custom properties из переданного CSS‑текста
 * или источника (путь / `file://` / `data:text/css`).
 *
 * Используйте, если в одном файле описано несколько тем/селекторов
 * и нужно разложить их по разным записям `tokenDefinitions`.
 */
export async function parseCssCustomPropertyBlocks(
  source: string,
): Promise<ParsedTokenBlock[]> {
  const css = looksLikeCssLiteral(source)
    ? source
    : await readCss(isCssDataUrl(source) ? source : resolveCssFilePath(source))
  return extractBlocks(css)
}

/** Синхронный аналог `parseCssCustomPropertyBlocks`. */
export function parseCssCustomPropertyBlocksSync(source: string): ParsedTokenBlock[] {
  const css = looksLikeCssLiteral(source) ? source : readCssSync(source)
  return extractBlocks(css)
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function parseAndPick(
  css: string,
  source: string,
  options: TokenDefinitionsFromCssOptions,
): GranularThemeTokenSet {
  const { selector = DEFAULT_SELECTOR, as, strict = true } = options
  const blocks = extractBlocks(css)

  if (blocks.length === 0) {
    if (strict)
      throw new Error(`tokenDefinitionsFromCss: no CSS custom properties found in ${truncate(source)}`)
    return { selector: as ?? selector, tokens: {} }
  }

  const exact = blocks.find(b => b.selector === selector)
  let picked: ParsedTokenBlock | undefined = exact
  if (!picked) {
    if (blocks.length === 1) {
      picked = blocks[0]
    }
    else if (strict) {
      throw new Error(
        `tokenDefinitionsFromCss: selector "${selector}" not found in ${truncate(source)}; `
        + `available selectors: ${blocks.map(b => JSON.stringify(b.selector)).join(', ')}`,
      )
    }
    else {
      picked = blocks[0]
    }
  }

  return {
    selector: as ?? picked.selector,
    tokens: picked.tokens,
  }
}

function readCssSync(source: string): string {
  if (isCssDataUrl(source))
    return decodeDataUrlSync(source)
  return readFileSync(resolveCssFilePath(source), 'utf8')
}

function decodeDataUrlSync(file: string): string {
  const match = file.match(/^data:([^,]*),(.*)$/s)
  if (!match)
    throw new Error(`Unsupported CSS data URL: ${file.slice(0, 64)}...`)
  const [, metadata = '', body = ''] = match
  if (metadata.includes(';base64'))
    return Buffer.from(body, 'base64').toString('utf8')
  return decodeURIComponent(body)
}

function looksLikeCssLiteral(source: string): boolean {
  // Мгновенная эвристика: если это не похоже на data:/file:/абсолютный путь
  // и содержит `{` — трактуем как готовый CSS. Используется только
  // публичным `parseCssCustomPropertyBlocks[Sync]`, не влияет на основные хелперы.
  if (isCssDataUrl(source))
    return false
  if (/^[a-z]+:\/\//i.test(source))
    return false
  if (source.startsWith('/') || /^[a-z]:[\\/]/i.test(source))
    return false
  return source.includes('{')
}

const BLOCK_RE = /([^{}]+)\{([^{}]*)\}/g
const DECL_RE = /--([\w-]+)\s*:([^;]*);/g

function extractBlocks(rawCss: string): ParsedTokenBlock[] {
  const css = stripComments(rawCss)
  const blocks: ParsedTokenBlock[] = []

  for (const match of css.matchAll(BLOCK_RE)) {
    const selector = normalizeSelector(match[1])
    if (!selector || selector.startsWith('@'))
      continue
    const body = match[2]
    const tokens: Record<string, string> = {}
    for (const decl of body.matchAll(DECL_RE)) {
      const value = decl[2].trim()
      if (value)
        tokens[decl[1]] = value
    }
    if (Object.keys(tokens).length > 0)
      blocks.push({ selector, tokens })
  }

  return blocks
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

function normalizeSelector(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

function truncate(value: string, max = 120): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}
