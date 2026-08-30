/**
 * Полный разбор CSS на блоки и объявления custom properties.
 *
 * Осознанно ОТДЕЛЬНАЯ функция от `parseCssCustomPropertyBlocksSync`
 * (`tokenDefinitionsFromCss.ts`). Та отвечает на вопрос «какой набор
 * `{ selector, tokens }` выражает этот файл» и потому обязана ПРОПУСКАТЬ
 * невыразимое: блоки внутри at-rules и вложенные. Эта отвечает на другой
 * вопрос — «какие байты в файле объявляют токен» — и обязана быть ПОЛНОЙ.
 *
 * Разница не академическая. У реального потребителя внутри
 * `@supports not (color: color-mix(…))` лежат fallback-объявления тех же
 * имён, что и в `:root`. Разбор, который их не видит, посчитает токен
 * объявленным один раз, а обрезка, построенная на нём, оставит в файле
 * осиротевший fallback удалённого токена.
 */

/** Одно объявление custom property с координатами в исходном тексте. */
export interface CssDeclarationOccurrence {
  /** Имя БЕЗ префикса `--`. */
  token: string
  /** Сырое значение — как в файле, без нормализации. */
  value: string
  /** Смещение первого символа `-` имени. */
  start: number
  /** Смещение ЗА последним символом объявления (включая `;`, если он есть). */
  end: number
  /** Полный путь прелюдий от корня: `['@supports not (…)', ':root']`. */
  path: readonly string[]
  /** Прелюдия ближайшего блока (последний элемент `path`); `''` вне блоков. */
  selector: string
}

/** Блок `прелюдия { … }` со своим содержимым. */
export interface CssBlock {
  /** Нормализованная прелюдия: селектор либо `@…`-условие. */
  prelude: string
  /** Смещение первого символа прелюдии. */
  start: number
  /** Смещение за `{`. */
  bodyStart: number
  /** Смещение за `}` (или конец текста у незакрытого блока). */
  end: number
  path: readonly string[]
  children: CssBlock[]
  /** Объявления custom properties НЕПОСРЕДСТВЕННО в этом блоке. */
  declarations: CssDeclarationOccurrence[]
  /**
   * В теле есть что-то, кроме custom properties, вложенных блоков и
   * пробельных символов, — обычные объявления вроде `color: red`.
   *
   * От этого зависит, можно ли удалить блок, оставшийся без токенов:
   * блок со смесью пустым не становится.
   */
  hasOtherContent: boolean
}

export interface CssScanResult {
  blocks: CssBlock[]
  /** Все объявления файла в порядке появления, включая вложенные. */
  declarations: CssDeclarationOccurrence[]
}

const WS = new Set([' ', '\t', '\n', '\r', '\f'])
const NAME_CHAR = /[\w-]/

function skipComment(css: string, i: number): number {
  const end = css.indexOf('*/', i + 2)
  return end < 0 ? css.length : end + 2
}

function skipString(css: string, i: number): number {
  const quote = css[i]
  let j = i + 1
  while (j < css.length) {
    if (css[j] === '\\') {
      j += 2
      continue
    }
    if (css[j] === quote)
      return j + 1
    j++
  }
  return css.length
}

/**
 * Конец значения объявления.
 *
 * Наивный поиск `;` ошибается на четырёх конструкциях, и все четыре
 * встречаются в живых файлах токенов: строковый литерал (`"; "`),
 * незакавыченный `url(data:…;base64,…)`, комментарий внутри значения и
 * вложенные скобки `color-mix(in srgb, var(--a), …)`. Плюс последнее
 * объявление блока вправе обойтись без `;` вовсе — тогда значение
 * заканчивает `}`.
 */
function scanValueEnd(css: string, from: number): { valueEnd: number, declEnd: number } {
  let i = from
  let depth = 0
  while (i < css.length) {
    const c = css[i]
    if (c === '/' && css[i + 1] === '*') {
      i = skipComment(css, i)
      continue
    }
    if (c === '"' || c === '\'') {
      i = skipString(css, i)
      continue
    }
    if (c === '(') {
      depth++
      i++
      continue
    }
    if (c === ')') {
      depth = depth > 0 ? depth - 1 : 0
      i++
      continue
    }
    if (depth === 0 && (c === ';' || c === '}'))
      return { valueEnd: i, declEnd: c === ';' ? i + 1 : i }
    i++
  }
  return { valueEnd: css.length, declEnd: css.length }
}

function normalizePrelude(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

/**
 * Разбирает CSS на дерево блоков и объявления custom properties.
 *
 * Обход посимвольный с состояниями (комментарий, строка, скобки) — регулярным
 * выражением это не выражается: значение токена вправе содержать и `;`, и
 * `{`, и кавычки.
 */
export function scanCssBlocks(css: string): CssScanResult {
  const roots: CssBlock[] = []
  const declarations: CssDeclarationOccurrence[] = []
  const stack: CssBlock[] = []

  // Начало непрочитанного текста текущего уровня — из него вырезается
  // прелюдия следующего блока.
  let chunkStart = 0
  // Объявление начинается только после `{`, `;`, `}` или в начале файла.
  let atDeclStart = true
  let i = 0

  const currentPath = (): string[] => stack.map(b => b.prelude)

  while (i < css.length) {
    const c = css[i]

    if (c === '/' && css[i + 1] === '*') {
      i = skipComment(css, i)
      continue
    }
    if (c === '"' || c === '\'') {
      i = skipString(css, i)
      atDeclStart = false
      continue
    }
    if (WS.has(c)) {
      i++
      continue
    }

    if (c === '{') {
      const rawPrelude = css.slice(chunkStart, i)
      const prelude = normalizePrelude(rawPrelude)
      const block: CssBlock = {
        prelude,
        start: chunkStart + (rawPrelude.length - rawPrelude.trimStart().length),
        bodyStart: i + 1,
        end: css.length,
        path: [...currentPath(), prelude],
        children: [],
        declarations: [],
        hasOtherContent: false,
      }
      const parent = stack[stack.length - 1]
      if (parent)
        parent.children.push(block)
      else
        roots.push(block)
      stack.push(block)
      chunkStart = i + 1
      atDeclStart = true
      i++
      continue
    }

    if (c === '}') {
      const block = stack.pop()
      if (block)
        block.end = i + 1
      chunkStart = i + 1
      atDeclStart = true
      i++
      continue
    }

    if (c === ';') {
      chunkStart = i + 1
      atDeclStart = true
      i++
      continue
    }

    if (atDeclStart && c === '-' && css[i + 1] === '-') {
      const start = i
      let j = i + 2
      while (j < css.length && NAME_CHAR.test(css[j] as string)) j++
      const token = css.slice(i + 2, j)

      // Между именем и `:` допустимы пробелы и комментарии.
      let k = j
      while (k < css.length) {
        if (css[k] === '/' && css[k + 1] === '*') {
          k = skipComment(css, k)
          continue
        }
        if (WS.has(css[k] as string)) {
          k++
          continue
        }
        break
      }

      if (token.length > 0 && css[k] === ':') {
        const { valueEnd, declEnd } = scanValueEnd(css, k + 1)
        const path = currentPath()
        const decl: CssDeclarationOccurrence = {
          token,
          value: css.slice(k + 1, valueEnd).trim(),
          start,
          end: declEnd,
          path,
          selector: path[path.length - 1] ?? '',
        }
        declarations.push(decl)
        stack[stack.length - 1]?.declarations.push(decl)
        i = declEnd
        chunkStart = declEnd
        atDeclStart = true
        continue
      }

      i = j
      atDeclStart = false
      continue
    }

    atDeclStart = false
    i++
  }

  for (const block of roots)
    markOtherContent(css, block)

  return { blocks: roots, declarations }
}

/**
 * Есть ли в теле блока что-то, кроме custom properties, вложенных блоков,
 * комментариев и пробелов.
 *
 * Считается ОСТАТКОМ, а не по ходу обхода: текст прелюдии вложенного блока
 * физически лежит в теле родителя, и пометка «здесь есть другое содержимое»
 * по ходу срабатывала бы на нём. Тогда `@supports`, внутри которого только
 * `:root { … }`, никогда не считался бы опустевшим — и оставался бы в файле
 * пустой скорлупой после обрезки всех своих токенов.
 */
function markOtherContent(css: string, block: CssBlock): void {
  for (const child of block.children)
    markOtherContent(css, child)

  const holes = [
    ...block.children.map(c => ({ start: c.start, end: c.end })),
    ...block.declarations.map(d => ({ start: d.start, end: d.end })),
  ].sort((a, b) => a.start - b.start)

  let residual = ''
  let cursor = block.bodyStart
  const bodyEnd = block.end > block.bodyStart ? block.end - 1 : block.bodyStart
  for (const hole of holes) {
    if (hole.start >= cursor)
      residual += css.slice(cursor, hole.start)
    cursor = Math.max(cursor, hole.end)
  }
  residual += css.slice(cursor, bodyEnd)

  block.hasOtherContent = residual.replace(/\/\*[\s\S]*?\*\//g, '').replace(/[;\s]/g, '').length > 0
}

/** Только объявления — самый частый запрос. */
export function scanCssDeclarations(css: string): CssDeclarationOccurrence[] {
  return scanCssBlocks(css).declarations
}
