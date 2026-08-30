/**
 * Чистые функции измерителя бюджета CSS/JS. Ни одного обращения к FS —
 * ввод только текстом, вывод только данными. I/O и печать живут в
 * `report-css-budget.mjs`.
 *
 * Разделение не косметическое: измеритель, который врёт, хуже отсутствия
 * измерителя, а врут здесь ровно эти функции — парсер объявлений, граф
 * достижимости и лестница доказательств. Отделённые от чтения `dist`, они
 * проверяются на строковых фикстурах.
 */

/**
 * Роли ассетов. Список УПОРЯДОЧЕН: первое совпадение выигрывает.
 *
 * Ассет, не подошедший ни под одно правило, роняет отчёт. Корзины «прочее»
 * здесь нет намеренно: она превращает разъехавшуюся раскладку стенда в
 * молчаливую потерю килобайтов.
 */
export const ASSET_ROLES = [
  { role: 'vue', test: /^vue-/ },
  { role: 'reset', test: /^reset-/ },
  { role: 'granular', test: /^granular-/ },
  { role: 'app', test: /^app-/ },
  { role: 'pkg', test: /^hpkg-/ },
  { role: 'entry', test: /^index-/ },
]

/** Роль ассета по имени файла; `undefined` — не классифицирован. */
export function classifyAsset(fileName) {
  return ASSET_ROLES.find(rule => rule.test.test(fileName))?.role
}

// ---------------------------------------------------------------------------
// CSS: объявления кастом-проперти
// ---------------------------------------------------------------------------

const WS = new Set([' ', '\t', '\n', '\r', '\f'])
const NAME_CHAR = /[\w-]/

/** Пропускает комментарий `/* … *\/`, если он начинается на `i`. */
function skipComment(css, i) {
  if (css[i] !== '/' || css[i + 1] !== '*')
    return i
  const end = css.indexOf('*/', i + 2)
  return end < 0 ? css.length : end + 2
}

/** Пропускает строковый литерал, начинающийся на `i`. */
function skipString(css, i) {
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
 * Конец значения объявления: индекс завершающей `;` (или `}`, если её нет).
 *
 * Учитывает всё, из-за чего наивный поиск `;` ошибается: строки, комментарии,
 * вложенные скобки и незакавыченный `url(…)`, внутри которого `;` — обычный
 * символ (`url(data:image/svg+xml;base64,…)`).
 */
function scanValueEnd(css, from) {
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
      depth = Math.max(0, depth - 1)
      i++
      continue
    }
    if (depth === 0 && (c === ';' || c === '}'))
      return { valueEnd: i, declEnd: c === ';' ? i + 1 : i }
    i++
  }
  return { valueEnd: css.length, declEnd: css.length }
}

/**
 * ВСЕ объявления кастом-проперти в тексте CSS — включая те, что внутри
 * at-rules (`@supports`, `@media`) и вложенных блоков.
 *
 * Полнота здесь обязательна, а не желательна: fallback-объявления производных
 * ролей живут именно внутри `@supports not (color: color-mix(…))`, и парсер,
 * который их не видит, сочтёт токен объявленным один раз, а он объявлен два.
 */
export function scanCssDeclarations(css) {
  const out = []
  let i = 0
  // Объявление начинается только там, где закончилось предыдущее:
  // после `{`, `;`, `}` или в начале файла.
  let atDeclStart = true

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
    if (c === '{' || c === ';' || c === '}') {
      atDeclStart = true
      i++
      continue
    }

    if (atDeclStart && c === '-' && css[i + 1] === '-') {
      const start = i
      let j = i + 2
      while (j < css.length && NAME_CHAR.test(css[j])) j++
      const token = css.slice(i + 2, j)

      // Между именем и `:` допустимы пробелы и комментарии.
      let k = j
      while (k < css.length) {
        if (css[k] === '/' && css[k + 1] === '*') {
          k = skipComment(css, k)
          continue
        }
        if (WS.has(css[k])) {
          k++
          continue
        }
        break
      }

      if (token && css[k] === ':') {
        const { valueEnd, declEnd } = scanValueEnd(css, k + 1)
        out.push({
          token,
          value: css.slice(k + 1, valueEnd).trim(),
          start,
          end: declEnd,
        })
        i = declEnd
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

  return out
}

/** Текст без указанных диапазонов. Диапазоны обязаны не пересекаться. */
export function stripRanges(text, ranges) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  let out = ''
  let cursor = 0
  for (const { start, end } of sorted) {
    if (start < cursor)
      continue
    out += text.slice(cursor, start)
    cursor = end
  }
  return out + text.slice(cursor)
}

// ---------------------------------------------------------------------------
// Потребление токенов
// ---------------------------------------------------------------------------

/**
 * В CSS спецсимволы имени класса экранируются (`.bg-\[var\(--x\)\]`), поэтому
 * перед поиском все `\x` схлопываются в `x`. Тот же приём, что в
 * `fs/tokenUsage.ts` пресета.
 */
export function unescapeCss(css) {
  return css.replace(/\\(.)/g, '$1')
}

const VAR_USE_RE = /var\(\s*--([\w-]+)\s*(,)?/g
const BARE_NAME_RE = /--([\w-]+)/g

/** Имена из `var(--x)` и признак fallback (`var(--x, …)`). */
export function collectVarUses(text) {
  const found = new Map()
  for (const m of text.matchAll(VAR_USE_RE))
    found.set(m[1], (found.get(m[1]) ?? false) || m[2] !== undefined)
  return found
}

/** Голые имена токенов — канал JS: ключ инлайн-стиля, аргумент `setProperty`. */
export function collectBareNames(text) {
  return new Set([...text.matchAll(BARE_NAME_RE)].map(m => m[1]))
}

/**
 * Достижимость токенов — то, ради чего это не `grep`.
 *
 * Токен, на который ссылается ТОЛЬКО значение другого, недостижимого токена,
 * мёртв, хотя `var(` для него в файле есть. На фундаменте с производными
 * `color-mix` плоский подсчёт систематически завышает живую долю.
 *
 * @param seed Токены, потреблённые ВНЕ значения кастом-проперти.
 * @param values Карта «токен → все его объявленные значения».
 */
export function reachableTokens(seed, values) {
  const reached = new Set(seed)
  const queue = [...seed]
  while (queue.length > 0) {
    const token = queue.pop()
    for (const value of values.get(token) ?? []) {
      for (const [name] of collectVarUses(value)) {
        if (!reached.has(name)) {
          reached.add(name)
          queue.push(name)
        }
      }
    }
  }
  return reached
}

// ---------------------------------------------------------------------------
// Классы
// ---------------------------------------------------------------------------

const CLASS_STOP = new Set([':', '.', '#', '[', ']', '(', ')', '>', '+', '~', ',', '{', '}', ' ', '\t', '\n', '\r', '\f', '*', '"', '\''])

/**
 * Селекторы классов из CSS.
 *
 * Экранирование учитывается: `\:` внутри `hover\:p-4` — часть имени, а
 * НЕэкранированное `:` (в `:hover`, `::before`) имя обрывает. Ровно это
 * различие отделяет утилиту-вариант от псевдокласса, и наивный
 * `/\.[\w-]+/` режет `hover\:p-4` на `hover` и теряет саму утилиту.
 */
export function extractCssClasses(css) {
  const out = new Set()
  let i = 0
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
    if (c !== '.') {
      i++
      continue
    }

    let j = i + 1
    let raw = ''
    while (j < css.length) {
      if (css[j] === '\\') {
        raw += css[j + 1] ?? ''
        j += 2
        continue
      }
      if (CLASS_STOP.has(css[j]))
        break
      raw += css[j]
      j++
    }
    // `.5rem` — не класс: имя не может начинаться с цифры.
    if (raw && !/^\d/.test(raw))
      out.add(raw)
    i = j > i ? j : i + 1
  }
  return out
}

/**
 * Лестница доказательств использования класса. Порядок — по убыванию силы.
 *
 * Доказательством считается ТОЛЬКО целый токен: `js-fragment` (найден лишь
 * литерал-префикс `"p-"`) доказательством не является, иначе двухсимвольный
 * префикс обелил бы вообще всё.
 */
export function classifyClassEvidence(klass, { htmlClasses, jsTokens, jsText, structuralClasses }) {
  const evidence = []
  if (htmlClasses.has(klass))
    evidence.push('html')
  if (jsTokens.has(klass))
    evidence.push('js-literal')
  if (structuralClasses.has(klass))
    evidence.push('component-css')

  if (evidence.length === 0) {
    // Класс собран конкатенацией: в бандле есть только литерал-префикс.
    const dash = klass.lastIndexOf('-')
    if (dash > 0 && jsText.includes(klass.slice(0, dash + 1)))
      evidence.push('js-fragment')
  }

  return {
    evidence,
    proven: evidence.includes('html') || evidence.includes('js-literal'),
  }
}

/** Целые токены из текста, разделённые пробелами. Корпус JS — уже без кавычек. */
export function whitespaceTokens(text) {
  return new Set(text.split(/\s+/).filter(Boolean))
}

/** Классы из атрибутов `class="…"` разметки. */
export function htmlClassTokens(html) {
  const out = new Set()
  for (const m of html.matchAll(/class\s*=\s*["']([^"']*)["']/g)) {
    for (const token of m[1].split(/\s+/))
      if (token)
        out.add(token)
  }
  return out
}

// ---------------------------------------------------------------------------
// Форматирование
// ---------------------------------------------------------------------------

export function formatBytes(n) {
  return n.toLocaleString('ru-RU').replace(/\u00A0/g, ' ')
}

export function formatDelta(n) {
  if (n === 0)
    return '0'
  return `${n > 0 ? '+' : '−'}${formatBytes(Math.abs(n))}`
}

export function percent(part, total) {
  return total === 0 ? 0 : Math.round((part / total) * 100)
}
