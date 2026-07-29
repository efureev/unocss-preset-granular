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
  return extractFlatBlocks(css, source)
}

/** Синхронный аналог `parseCssCustomPropertyBlocks`. */
export function parseCssCustomPropertyBlocksSync(source: string): ParsedTokenBlock[] {
  const css = looksLikeCssLiteral(source) ? source : readCssSync(source)
  return extractFlatBlocks(css, source)
}

/**
 * Плоские блоки + предупреждение (один раз на сообщение) про вложенные и
 * at-rule-блоки, которые контракт `{ selector, tokens }` выразить не может.
 */
function extractFlatBlocks(css: string, source: string): ParsedTokenBlock[] {
  const { blocks, skipped } = extractBlocksDetailed(css)
  if (skipped.length > 0) {
    warnOnce(
      `parseCssCustomPropertyBlocks: skipped unsupported CSS block(s) in ${truncate(source)}: `
      + `${describeSkipped(skipped)}. Only flat top-level blocks are parsed.`,
    )
  }
  return blocks
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
  const { blocks, skipped } = extractBlocksDetailed(css)

  if (skipped.length > 0) {
    const message
      = `tokenDefinitionsFromCss: unsupported CSS block(s) in ${truncate(source)}: ${describeSkipped(skipped)}. `
        + 'Only flat top-level blocks are parsed; move the custom properties to a top-level selector.'
    if (strict)
      throw new Error(message)
    warnOnce(message)
  }

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

// Точка с запятой у ПОСЛЕДНЕГО объявления в блоке опциональна — CSS это
// разрешает, поэтому конец тела блока тоже завершает объявление.
const DECL_RE = /--([\w-]+)\s*:([^;]*)(?:;|$)/g

/** Блок, который парсер нашёл, но не может представить как плоский. */
interface SkippedBlock {
  /** Полный путь селекторов от корня файла: `['@media (...)', ':root']`. */
  path: readonly string[]
  reason: 'at-rule' | 'nested'
}

interface ExtractResult {
  blocks: ParsedTokenBlock[]
  skipped: SkippedBlock[]
}

/**
 * Разбирает CSS на блоки верхнего уровня с custom properties.
 *
 * Поддерживаются только ПЛОСКИЕ блоки: вложенные (CSS Nesting) и любые
 * блоки внутри at-rules (`@media`, `@supports`, ...) не могут быть выражены
 * парой `{ selector, tokens }` — они попадают в `skipped`, а вызывающий код
 * решает, бросать ошибку или предупреждать. Молча отдавать внутренний
 * селектор как безусловный нельзя: это тихо ломает тему.
 */
function extractBlocksDetailed(rawCss: string): ExtractResult {
  const css = stripComments(rawCss)
  const blocks: ParsedTokenBlock[] = []
  const skipped: SkippedBlock[] = []

  // Стек открытых уровней: прелюдия (селектор / at-rule-условие) и накопленные
  // куски СОБСТВЕННОГО тела — куски, потому что вложенный блок разрывает тело
  // уровня на части (`--a: 1px; @media … { … } --b: 2px`).
  const stack: Array<{ prelude: string, body: string[] }> = []
  // Позиция, с которой идёт непрочитанный текст текущего уровня.
  let chunkStart = 0

  for (let i = 0; i < css.length; i++) {
    const ch = css[i]
    if (ch !== '{' && ch !== '}')
      continue

    if (ch === '{') {
      // Текст до `{` — это хвост тела родителя плюс прелюдия нового уровня.
      // Граница — последняя `;`: ни селектор, ни at-rule-прелюдия её не содержат.
      const raw = css.slice(chunkStart, i)
      const cut = raw.lastIndexOf(';')
      if (cut >= 0)
        stack[stack.length - 1]?.body.push(raw.slice(0, cut + 1))
      stack.push({ prelude: normalizeSelector(raw.slice(cut + 1)), body: [] })
      chunkStart = i + 1
      continue
    }

    const level = stack.pop()
    if (!level) {
      // Непарная закрывающая скобка — дальше разбирать нечего.
      break
    }

    level.body.push(css.slice(chunkStart, i))
    chunkStart = i + 1

    const tokens = parseDeclarations(level.body)
    if (Object.keys(tokens).length === 0)
      continue

    const path = [...stack.map(l => l.prelude), level.prelude]
    if (path.some(p => p.startsWith('@')))
      skipped.push({ path, reason: 'at-rule' })
    else if (stack.length > 0)
      skipped.push({ path, reason: 'nested' })
    else if (level.prelude)
      blocks.push({ selector: level.prelude, tokens })
  }

  return { blocks, skipped }
}

function parseDeclarations(bodyChunks: readonly string[]): Record<string, string> {
  const tokens: Record<string, string> = {}
  // Куски склеиваются через `;`: между ними стоял вложенный блок, и объявление
  // не может «перетечь» из одного куска в другой.
  for (const decl of bodyChunks.join(';').matchAll(DECL_RE)) {
    const value = decl[2].trim()
    if (value)
      tokens[decl[1]] = value
  }
  return tokens
}

function describeSkipped(skipped: readonly SkippedBlock[]): string {
  return skipped
    .map(s => `${JSON.stringify(s.path.join(' > '))} (${s.reason === 'at-rule' ? 'inside an at-rule' : 'nested block'})`)
    .join(', ')
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

function normalizeSelector(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

const warned = new Set<string>()

/** Не засорять вывод: одно и то же сообщение печатается один раз за процесс. */
function warnOnce(message: string): void {
  if (warned.has(message))
    return
  warned.add(message)
  console.warn(`[granular] ${message}`)
}

function truncate(value: string, max = 120): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}
