#!/usr/bin/env node
/**
 * Проверяет зеркальность англоязычной и русской документации.
 *
 * `docs/en/*.md` и `docs/ru/*.md` — парные файлы: правка в одном без парной
 * правки во втором создаёт расхождение, которое ничем не ловится (текст на
 * двух языках, diff'ом не сравнить). Скрипт сравнивает не текст, а СКЕЛЕТ —
 * то, что от языка не зависит:
 *
 *   1. набор файлов в `docs/en` и `docs/ru`;
 *   2. последовательность уровней заголовков (`##`, `###`, ...);
 *   3. последовательность языков блоков кода (```ts, ```bash, ...);
 *   4. мультимножество относительных ссылок на `.md` (цели, не подписи)
 *      + существование каждой цели;
 *   5. число строк — с допуском, перевод почти всегда чуть короче/длиннее.
 *
 * Та же проверка применяется к корневым `README.md` / `README.ru.md`.
 *
 * Использование:
 *   node scripts/check-docs-parity.mjs        # 0 — паритет, 1 — расхождения
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

/** Допуск на разницу в числе строк: перевод не обязан быть строка-в-строку. */
const LINE_TOLERANCE_ABS = 4
const LINE_TOLERANCE_REL = 0.03

// ---------------------------------------------------------------------------
// Разбор markdown
// ---------------------------------------------------------------------------

/**
 * Скелет документа: всё, что обязано совпадать у пары переводов.
 *
 * Заголовки и ссылки собираются в обход блоков кода — иначе `# comment`
 * внутри ```bash уедет в список заголовков и даст ложное расхождение.
 */
function parseSkeleton(text) {
  const lines = text.split('\n')
  const headings = []
  const fences = []
  const links = []
  let fence = null

  for (const line of lines) {
    const fenceMatch = /^\s*(`{3,}|~{3,})(.*)$/.exec(line)
    if (fenceMatch) {
      const [, marker, info] = fenceMatch
      if (fence === null) {
        fence = marker[0].repeat(3)
        fences.push(info.trim().split(/\s+/)[0] || '(none)')
      }
      else if (marker.startsWith(fence)) {
        fence = null
      }
      continue
    }
    if (fence !== null)
      continue

    const heading = /^(#{1,6})\s+\S/.exec(line)
    if (heading)
      headings.push(heading[1].length)

    // Только относительные ссылки на markdown: абсолютные URL и якори внутри
    // страницы переводятся вместе с заголовками и совпадать не обязаны.
    for (const m of line.matchAll(/]\((\.[^)\s]+\.md(?:#[^)\s]*)?)\)/g))
      links.push(m[1])
  }

  return { headings, fences, links, lineCount: lines.length }
}

// ---------------------------------------------------------------------------
// Сравнение пары
// ---------------------------------------------------------------------------

const problems = []

function fail(pair, message) {
  problems.push(`${pair}: ${message}`)
}

function formatSeq(seq) {
  return seq.length ? seq.join(' ') : '(пусто)'
}

/**
 * Ссылки в паре указывают на файлы своей локали, поэтому сравнивать сырые
 * пути нельзя: `./cli.md` из `docs/en` и из `docs/ru` — разные файлы, но
 * одна и та же цель. Нормализуем, срезая сегмент локали.
 *
 * Якорь заменяется на маркер `#`, а не сравнивается: он слаг заголовка, то
 * есть переведён. Но факт его наличия сравнивать надо — ссылка на раздел в
 * одной локали и на начало файла в другой это расхождение.
 */
function normalizeLink(link) {
  const [path, anchor] = link.split('#')
  return path.replace(/(^|\/)(?:en|ru)(\/|$)/g, '$1<locale>$2') + (anchor === undefined ? '' : '#')
}

function checkLinkTargets(file, links) {
  for (const link of links) {
    const target = resolve(dirname(file), link.split('#')[0])
    let exists = true
    try {
      statSync(target)
    }
    catch {
      exists = false
    }
    if (!exists)
      fail(relative(root, file), `битая ссылка на '${link}'`)
  }
}

function comparePair(enFile, ruFile) {
  const pair = `${relative(root, enFile)} ↔ ${relative(root, ruFile)}`
  const en = parseSkeleton(readFileSync(enFile, 'utf8'))
  const ru = parseSkeleton(readFileSync(ruFile, 'utf8'))

  if (formatSeq(en.headings) !== formatSeq(ru.headings)) {
    fail(pair, `разная структура заголовков (${en.headings.length} en / ${ru.headings.length} ru)\n`
      + `      en: ${formatSeq(en.headings)}\n`
      + `      ru: ${formatSeq(ru.headings)}`)
  }

  if (formatSeq(en.fences) !== formatSeq(ru.fences)) {
    fail(pair, `разный набор блоков кода (${en.fences.length} en / ${ru.fences.length} ru)\n`
      + `      en: ${formatSeq(en.fences)}\n`
      + `      ru: ${formatSeq(ru.fences)}`)
  }

  const enLinks = en.links.map(normalizeLink).sort()
  const ruLinks = ru.links.map(normalizeLink).sort()
  if (formatSeq(enLinks) !== formatSeq(ruLinks)) {
    const only = (a, b) => a.filter(l => !b.includes(l))
    fail(pair, 'разный набор ссылок на документацию\n'
      + `      только в en: ${formatSeq(only(enLinks, ruLinks))}\n`
      + `      только в ru: ${formatSeq(only(ruLinks, enLinks))}`)
  }

  const delta = Math.abs(en.lineCount - ru.lineCount)
  const allowed = Math.max(LINE_TOLERANCE_ABS, Math.round(en.lineCount * LINE_TOLERANCE_REL))
  if (delta > allowed) {
    fail(pair, `расходится объём: ${en.lineCount} строк en / ${ru.lineCount} ru `
      + `(разница ${delta} > допуска ${allowed})`)
  }

  checkLinkTargets(enFile, en.links)
  checkLinkTargets(ruFile, ru.links)
}

// ---------------------------------------------------------------------------
// Сбор пар
// ---------------------------------------------------------------------------

function listMarkdown(dir) {
  return readdirSync(dir).filter(f => f.endsWith('.md')).sort()
}

const enDir = join(root, 'docs/en')
const ruDir = join(root, 'docs/ru')
const enFiles = listMarkdown(enDir)
const ruFiles = listMarkdown(ruDir)

const onlyEn = enFiles.filter(f => !ruFiles.includes(f))
const onlyRu = ruFiles.filter(f => !enFiles.includes(f))
if (onlyEn.length)
  problems.push(`docs/ru: нет перевода для ${onlyEn.join(', ')}`)
if (onlyRu.length)
  problems.push(`docs/en: нет оригинала для ${onlyRu.join(', ')}`)

for (const file of enFiles.filter(f => ruFiles.includes(f)))
  comparePair(join(enDir, file), join(ruDir, file))

comparePair(join(root, 'README.md'), join(root, 'README.ru.md'))

// ---------------------------------------------------------------------------
// Отчёт
// ---------------------------------------------------------------------------

const pairCount = enFiles.filter(f => ruFiles.includes(f)).length + 1

if (problems.length === 0) {
  console.log(`✓ docs parity — ${pairCount} пар(ы) en/ru синхронны.`)
  process.exit(0)
}

console.error(`✗ docs parity — расхождений: ${problems.length}\n`)
for (const p of problems)
  console.error(`  • ${p}`)
console.error('\nПравило: docs/en/*.md и docs/ru/*.md — зеркала. Правка в одном требует парной правки во втором.')
process.exit(1)
