import type { CssBlock } from './cssDeclarations'

import { scanCssBlocks } from './cssDeclarations'

export interface PruneCssResult {
  css: string
  /** Имена удалённых токенов (без `--`), без повторов, в порядке появления. */
  removed: string[]
  /** Пути блоков, опустевших и удалённых целиком: `'@supports … > :root'`. */
  emptiedBlocks: string[]
}

interface Range { start: number, end: number }

const HORIZONTAL_WS = new Set([' ', '\t'])

/**
 * Расширяет диапазон удаления на отступ слева и перевод строки справа.
 *
 * Без этого обрезанный файл покрывается дырами из пустых строк: объявление
 * занимало строку целиком, а удалялось без неё. На минифицированном CSS
 * (всё в одну строку) расширение не срабатывает — справа стоит не перевод
 * строки, а следующее объявление.
 */
function widen(css: string, range: Range): Range {
  let { start, end } = range

  while (start > 0 && HORIZONTAL_WS.has(css[start - 1] as string))
    start--

  let after = end
  while (after < css.length && HORIZONTAL_WS.has(css[after] as string))
    after++
  if (css[after] === '\n')
    end = after + 1
  else if (css[after] === '\r' && css[after + 1] === '\n')
    end = after + 2

  return { start, end }
}

/** Блок целиком не нужен: ни своих токенов, ни живых детей, ни прочего. */
function isBlockEmptied(block: CssBlock, isKept: (token: string) => boolean): boolean {
  if (block.hasOtherContent)
    return false
  if (block.declarations.some(decl => isKept(decl.token)))
    return false
  return block.children.every(child => isBlockEmptied(child, isKept))
}

function collectRanges(
  blocks: readonly CssBlock[],
  isKept: (token: string) => boolean,
  out: { ranges: Range[], removed: string[], emptied: string[] },
): void {
  for (const block of blocks) {
    if (isBlockEmptied(block, isKept)) {
      // Блок уходит целиком — вместе с прелюдией и скобками. Его объявления
      // отдельными диапазонами не добавляем: они уже внутри.
      out.ranges.push({ start: block.start, end: block.end })
      out.emptied.push(block.path.join(' > '))
      for (const decl of allDeclarations(block))
        out.removed.push(decl.token)
      continue
    }

    for (const decl of block.declarations) {
      if (!isKept(decl.token)) {
        out.ranges.push({ start: decl.start, end: decl.end })
        out.removed.push(decl.token)
      }
    }

    collectRanges(block.children, isKept, out)
  }
}

function allDeclarations(block: CssBlock): Array<{ token: string }> {
  return [...block.declarations, ...block.children.flatMap(allDeclarations)]
}

/**
 * Удаляет из текста CSS объявления custom properties, не прошедшие `isKept`.
 *
 * ТЕКСТОВАЯ ХИРУРГИЯ, а не пересборка. At-rules, комментарии, обычные
 * правила, форматирование и порядок сохраняются побайтно — вырезаются только
 * диапазоны удаляемых объявлений и блоков, опустевших после них.
 *
 * Пересборка из `{ selector, tokens }` здесь не годится принципиально: этот
 * контракт не выражает ни at-rules, ни вложенности, ни комментариев, и всё
 * невыразимое пропало бы молча.
 *
 * Комментарии НЕ удаляются даже осиротевшие. В файлах токенов они —
 * заголовки групп (`/* Surface roles *\/`), относящиеся к набору объявлений,
 * а не к следующему за ними: привязать их к соседу значит удалять заголовки,
 * которые ещё актуальны. Цена — заголовок без содержимого в обрезанном файле.
 *
 * ГАРАНТИЯ: если не удалено ничего — возвращается ТОТ ЖЕ `css` по ссылке.
 * На ней держится обещание «выключенная обрезка не меняет эмиссию ни на байт».
 */
export function pruneCssDeclarations(
  css: string,
  isKept: (token: string) => boolean,
): PruneCssResult {
  const { blocks } = scanCssBlocks(css)
  const out = { ranges: [] as Range[], removed: [] as string[], emptied: [] as string[] }
  collectRanges(blocks, isKept, out)

  if (out.ranges.length === 0)
    return { css, removed: [], emptiedBlocks: [] }

  const widened = out.ranges
    .map(range => widen(css, range))
    .sort((a, b) => a.start - b.start)

  let result = ''
  let cursor = 0
  for (const { start, end } of widened) {
    if (start < cursor) {
      cursor = Math.max(cursor, end)
      continue
    }
    result += css.slice(cursor, start)
    cursor = end
  }
  result += css.slice(cursor)

  return {
    css: result,
    removed: [...new Set(out.removed)],
    emptiedBlocks: out.emptied,
  }
}
