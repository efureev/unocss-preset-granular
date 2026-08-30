#!/usr/bin/env node
/**
 * Бюджет CSS/JS собранного приложения: что уехало в дистрибутив, сколько это
 * весит и что из уехавшего не используется.
 *
 * Отчёт отвечает на три вопроса, которые до него в репозитории не задавались:
 *   1. сколько стоит подключение компонента поверх пустого приложения;
 *   2. какие CSS-переменные объявлены в дистрибутиве и не потребляются;
 *   3. какие записи `safelist` не дали CSS вовсе.
 *
 * Порога на байты здесь НЕТ и не будет: gzip невоспроизводим между средами, а
 * порог, взятый с потолка, краснеет на честном росте, и его научаются
 * поднимать не глядя. Гейтятся только булевы факты (`--strict`).
 *
 * Использование:
 *   node scripts/report-css-budget.mjs
 *   node scripts/report-css-budget.mjs --stand bench-one --baseline bench-zero
 *   node scripts/report-css-budget.mjs --json
 *   node scripts/report-css-budget.mjs --strict
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import process from 'node:process'
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib'
import { fileURLToPath, pathToFileURL, URL } from 'node:url'

import {
  classifyAsset,
  classifyClassEvidence,
  collectBareNames,
  collectVarUses,
  extractCssClasses,
  formatBytes,
  formatDelta,
  htmlClassTokens,
  percent,
  reachableTokens,
  scanCssDeclarations,
  stripRanges,
  unescapeCss,
  whitespaceTokens,
} from './cssBudget.mjs'

const ROOT = fileURLToPath(new URL('../', import.meta.url))

class BudgetError extends Error {}

// ---------------------------------------------------------------------------
// Аргументы
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const flags = new Set()
  const named = new Map()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--'))
      continue
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      named.set(arg, next)
      i++
    }
    else {
      flags.add(arg)
    }
  }
  return { flags, named }
}

// ---------------------------------------------------------------------------
// Чтение дистрибутива
// ---------------------------------------------------------------------------

function readStand(app) {
  const distDir = join(ROOT, 'apps', app, 'dist')
  const assetsDir = join(distDir, 'assets')
  if (!existsSync(assetsDir))
    throw new BudgetError(`нет '${assetsDir}'. Сначала: yarn build:all`)

  const assets = readdirSync(assetsDir)
    .filter(name => /\.(?:css|js)$/.test(name))
    .map((name) => {
      const buffer = readFileSync(join(assetsDir, name))
      return {
        file: name,
        kind: name.endsWith('.css') ? 'css' : 'js',
        role: classifyAsset(name),
        raw: buffer.length,
        gzip: gzipSync(buffer).length,
        brotli: brotliCompressSync(buffer, {
          params: {
            [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
            [zlibConstants.BROTLI_PARAM_SIZE_HINT]: buffer.length,
          },
        }).length,
        text: buffer.toString('utf8'),
      }
    })
    .sort((a, b) => a.raw - b.raw)

  const unknown = assets.filter(a => a.role === undefined)
  if (unknown.length > 0) {
    throw new BudgetError(
      `раскладка стенда '${app}' разошлась с классификатором: не опознаны `
      + `${unknown.map(a => `'${a.file}'`).join(', ')}.\n`
      + 'Корзины «прочее» здесь нет намеренно — она превращает разъехавшуюся '
      + 'раскладку в молчаливую потерю килобайтов. Правьте ASSET_ROLES в scripts/cssBudget.mjs.',
    )
  }

  const htmlPath = join(distDir, 'index.html')
  const metaPath = join(distDir, 'bench-meta.json')

  return {
    app,
    assets,
    html: existsSync(htmlPath) ? readFileSync(htmlPath, 'utf8') : '',
    meta: existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : null,
  }
}

/** Суммы по ролям. */
function rolesOf(stand) {
  const roles = {}
  for (const asset of stand.assets) {
    const bucket = roles[asset.role] ?? (roles[asset.role] = { raw: 0, gzip: 0, brotli: 0 })
    bucket.raw += asset.raw
    bucket.gzip += asset.gzip
    bucket.brotli += asset.brotli
  }
  return roles
}

// ---------------------------------------------------------------------------
// Анализ
// ---------------------------------------------------------------------------

/**
 * Корпус JS: кавычки снимаются, потому что их стиль выбирает бандлер и фактом
 * о сборке не является. Тот же приём, что в `verify-apps.mjs`.
 */
function jsCorpus(stand) {
  return stand.assets.filter(a => a.kind === 'js').map(a => a.text).join('\n')
}

function cssCorpus(stand, roles) {
  return stand.assets
    .filter(a => a.kind === 'css' && (roles === undefined || roles.includes(a.role)))
    .map(a => a.text)
    .join('\n')
}

function analyzeTokens(stand, prefix) {
  const css = unescapeCss(cssCorpus(stand))
  const js = jsCorpus(stand)
  const jsStripped = js.replace(/["'`]/g, '')

  const decls = scanCssDeclarations(css)
  const values = new Map()
  for (const decl of decls) {
    const list = values.get(decl.token) ?? []
    list.push(decl.value)
    values.set(decl.token, list)
  }

  // Seed — потребления ВНЕ значений кастом-проперти. Порядок важен: `var()`
  // внутри объявления, которое само может оказаться мёртвым, корнем не является.
  const outsideDeclarations = stripRanges(css, decls)
  const cssUses = collectVarUses(outsideDeclarations)
  const jsVarUses = collectVarUses(jsStripped)
  const jsBareNames = collectBareNames(jsStripped)
  const htmlUses = collectVarUses(stand.html)

  const channels = {
    'css-var': [...cssUses.keys()],
    'js-var': [...jsVarUses.keys()],
    'js-name': [...jsBareNames],
    'html': [...htmlUses.keys()],
  }

  const seed = new Set([
    ...cssUses.keys(),
    ...jsVarUses.keys(),
    ...jsBareNames,
    ...htmlUses.keys(),
  ])
  const reachable = reachableTokens(seed, values)

  const isSubject = token => prefix === undefined || token.startsWith(`${prefix}-`) || token === 'radius'
  const declared = [...new Set(decls.map(d => d.token))].filter(isSubject).sort()

  // Плоское потребление: `var(` есть где угодно, включая значения других токенов.
  const flatUses = new Set([...seed, ...collectVarUses(css).keys()])

  const consumedFlat = declared.filter(t => flatUses.has(t))
  const reachableDeclared = declared.filter(t => reachable.has(t))
  const unused = declared.filter(t => !reachable.has(t))
  const onlyViaDeadToken = consumedFlat.filter(t => !reachable.has(t))

  // Потребляется, но не объявлено. Срабатывание — только без fallback ни в
  // одном месте: `var(--un-shadow-color, #0000000d)` из presetMini иначе даёт
  // ложную находку на каждом прогоне.
  const declaredAll = new Set(decls.map(d => d.token))
  const allUses = new Map()
  for (const [token, fb] of collectVarUses(css))
    allUses.set(token, (allUses.get(token) ?? false) || fb)
  for (const [token, fb] of jsVarUses)
    allUses.set(token, (allUses.get(token) ?? false) || fb)

  const undeclaredNoFallback = []
  const undeclaredWithFallback = []
  for (const [token, hasFallback] of allUses) {
    if (declaredAll.has(token))
      continue
    ;(hasFallback ? undeclaredWithFallback : undeclaredNoFallback).push(token)
  }

  return {
    prefix,
    declared: declared.length,
    consumedFlat: consumedFlat.length,
    reachable: reachableDeclared.length,
    unused,
    onlyViaDeadToken,
    undeclaredNoFallback: undeclaredNoFallback.sort(),
    undeclaredWithFallback: undeclaredWithFallback.sort(),
    channels: Object.fromEntries(
      Object.entries(channels).map(([k, v]) => [k, v.filter(isSubject).sort()]),
    ),
  }
}

function analyzeClasses(stand) {
  // ВАЖНО: CSS берётся СЫРЫМ, без `unescapeCss`. Экранирование разбирает сам
  // экстрактор, и только он знает, что `\[` — часть имени, а `[` — конец
  // селектора. Снятое заранее, оно превращает `.bg-\[var\(--x\)\]`
  // в `.bg-[var(--x)]`, и класс обрезается до `bg-`.
  const utilityCss = cssCorpus(stand, ['app'])
  const structuralCss = cssCorpus(stand, ['granular', 'pkg'])

  const utilities = extractCssClasses(utilityCss)
  const structural = extractCssClasses(structuralCss)

  const js = jsCorpus(stand).replace(/["'`]/g, ' ')
  const jsTokens = whitespaceTokens(js)
  const htmlClasses = htmlClassTokens(stand.html)

  const all = [...new Set([...utilities, ...structural])].sort()
  const rows = all.map(klass => ({
    class: klass,
    kind: utilities.has(klass) ? 'utility' : 'structural',
    ...classifyClassEvidence(klass, { htmlClasses, jsTokens, jsText: js, structuralClasses: structural }),
  }))

  return { rows, utilities, structural, jsTokens, htmlClasses, jsText: js }
}

function analyzeSafelist(stand, classes) {
  if (!stand.meta?.safelist)
    return null

  // Тоже сырой CSS — по той же причине, что в `analyzeClasses`.
  const present = extractCssClasses(cssCorpus(stand))

  // Пересечение с файловым сканом: те же globs, которыми пресет кормит
  // `content.filesystem`, поэтому утверждение точное, а не догадка.
  const scannedText = readScannedSources(stand.meta.scanGlobs ?? [])
  const scannedTokens = whitespaceTokens(scannedText.replace(/["'`<>=]/g, ' '))

  const dead = []
  const proven = []
  const unproven = []
  const redundantWithScan = []

  for (const entry of stand.meta.safelist) {
    if (!present.has(entry)) {
      dead.push(entry)
      continue
    }
    const row = classes.rows.find(r => r.class === entry)
    if (row?.proven)
      proven.push(entry)
    else
      unproven.push(entry)
    if (scannedTokens.has(entry))
      redundantWithScan.push(entry)
  }

  return { entries: stand.meta.safelist.length, dead, proven, unproven, redundantWithScan }
}

/** Файлы, попадающие под скан-globs пресета. Glob сводится к своей директории. */
function readScannedSources(globs) {
  const chunks = []
  for (const glob of globs) {
    const dir = glob.split('/**/')[0]
    if (!existsSync(dir))
      continue
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile())
        continue
      const path = join(entry.parentPath ?? entry.path, entry.name)
      if (!/\.(?:js|mjs|cjs|ts|mts|cts|jsx|tsx|vue)$/.test(path))
        continue
      try {
        chunks.push(readFileSync(path, 'utf8'))
      }
      catch {
        // Файл исчез между обходом и чтением — не повод ронять отчёт.
      }
    }
  }
  return chunks.join('\n')
}

// ---------------------------------------------------------------------------
// Печать
// ---------------------------------------------------------------------------

function pad(value, width) {
  return String(value).padStart(width)
}

function padEnd(value, width) {
  return String(value).padEnd(width)
}

function printAssets(out, stand) {
  out.push('АССЕТЫ', '')
  out.push(`  ${padEnd('роль', 10)}${padEnd('файл', 30)}${pad('raw', 10)}${pad('gzip', 10)}${pad('brotli', 10)}`)
  out.push(`  ${'─'.repeat(70)}`)
  for (const a of stand.assets)
    out.push(`  ${padEnd(a.role, 10)}${padEnd(a.file, 30)}${pad(formatBytes(a.raw), 10)}${pad(formatBytes(a.gzip), 10)}${pad(formatBytes(a.brotli), 10)}`)
  out.push('')
}

function printRoles(out, stand, baseline) {
  const here = rolesOf(stand)
  const there = baseline ? rolesOf(baseline) : {}
  const names = [...new Set([...Object.keys(there), ...Object.keys(here)])]

  out.push(`ПО РОЛЯМ, gzip${baseline ? ` — ${stand.app} против ${baseline.app}` : ''}`, '')
  out.push(`  ${padEnd('роль', 12)}${pad(baseline ? baseline.app : "—", 14)}${pad(stand.app, 14)}${pad('Δ', 10)}`)
  out.push(`  ${'─'.repeat(50)}`)

  let totalHere = 0
  let totalThere = 0
  let vueHere = 0
  let vueThere = 0

  for (const name of names) {
    const a = there[name]?.gzip ?? 0
    const b = here[name]?.gzip ?? 0
    totalThere += a
    totalHere += b
    if (name === 'vue') {
      vueThere = a
      vueHere = b
    }
    const mark = a === 0 && b > 0 ? '  новое' : ''
    out.push(`  ${padEnd(name, 12)}${pad(a === 0 ? '—' : formatBytes(a), 14)}${pad(formatBytes(b), 14)}${pad(formatDelta(b - a), 10)}${mark}`)
  }

  out.push(`  ${'─'.repeat(50)}`)
  out.push(`  ${padEnd('всего', 12)}${pad(formatBytes(totalThere), 14)}${pad(formatBytes(totalHere), 14)}${pad(formatDelta(totalHere - totalThere), 10)}`)
  out.push(`  ${padEnd('без vue', 12)}${pad(formatBytes(totalThere - vueThere), 14)}${pad(formatBytes(totalHere - vueHere), 14)}${pad(formatDelta((totalHere - vueHere) - (totalThere - vueThere)), 10)}`)
  out.push('')
}

function printTokens(out, tokens, top) {
  out.push(`ТОКЕНЫ  --${tokens.prefix}-`, '')
  out.push(`  ${padEnd('объявлено в дистрибутиве', 38)}${pad(tokens.declared, 5)}`)
  out.push(`  ${padEnd('потребляется плоско', 38)}${pad(tokens.consumedFlat, 5)}`)
  out.push(`  ${padEnd('достижимо от реального потребления', 38)}${pad(tokens.reachable, 5)}`)
  out.push(`  ${'─'.repeat(43)}`)
  out.push(`  ${padEnd('мёртвый груз', 38)}${pad(tokens.unused.length, 5)}   (${percent(tokens.unused.length, tokens.declared)} %)`)
  out.push('')
  out.push('  каналы потребления:')
  for (const [name, list] of Object.entries(tokens.channels))
    out.push(`    ${padEnd(name, 12)}${pad(list.length, 4)}`)
  if (tokens.onlyViaDeadToken.length > 0) {
    out.push('')
    out.push(`    только из значения другого (недостижимого) токена: ${tokens.onlyViaDeadToken.length}`)
    out.push(`      ${tokens.onlyViaDeadToken.slice(0, top).map(t => `--${t}`).join(' ')}`)
  }
  out.push('')
  if (tokens.undeclaredNoFallback.length > 0) {
    out.push(`  ⚠ потребляются без fallback, но нигде не объявлены: ${tokens.undeclaredNoFallback.length}`)
    out.push(`      ${tokens.undeclaredNoFallback.map(t => `--${t}`).join(' ')}`)
  }
  else {
    out.push('  ✓ потребляемых без fallback и необъявленных нет')
  }
  out.push('')
  if (tokens.unused.length > 0) {
    out.push(`  мёртвые (${tokens.unused.length})${tokens.unused.length > top ? `, первые ${top} — полный список в --json` : ''}:`)
    out.push(`      ${tokens.unused.slice(0, top).map(t => `--${t}`).join(' ')}`)
    out.push('')
  }
}

function printClasses(out, classes) {
  const rows = classes.rows
  const byEvidence = kind => rows.filter(r => r.evidence.includes(kind))
  const orphan = rows.filter(r => r.evidence.length === 0)

  out.push('КЛАССЫ', '')
  out.push(`  ${padEnd('селекторов классов в CSS', 30)}${pad(rows.length, 5)}`)
  out.push(`  ${padEnd('  утилиты UnoCSS', 30)}${pad(rows.filter(r => r.kind === 'utility').length, 5)}`)
  out.push(`  ${padEnd('  структурные (CSS пакета)', 30)}${pad(rows.filter(r => r.kind === 'structural').length, 5)}`)
  out.push('')
  out.push('  доказательство:')
  out.push(`    ${padEnd('html', 16)}${pad(byEvidence('html').length, 4)}`)
  out.push(`    ${padEnd('js-literal', 16)}${pad(byEvidence('js-literal').length, 4)}`)
  out.push(`    ${padEnd('component-css', 16)}${pad(byEvidence('component-css').length, 4)}`)
  out.push(`    ${'─'.repeat(20)}`)
  const unproven = rows.filter(r => !r.proven && !r.evidence.includes('component-css'))
  out.push(`    ${padEnd('не доказано', 16)}${pad(unproven.length, 4)}   ${unproven.slice(0, 8).map(r => r.class).join('  ')}`)
  if (orphan.length > 0)
    out.push(`    ${padEnd('из них ничем', 16)}${pad(orphan.length, 4)}   ${orphan.slice(0, 8).map(r => r.class).join('  ')}`)

  // Инвариант: корзины обязаны покрывать все классы.
  const covered = new Set([...byEvidence('html'), ...byEvidence('js-literal'), ...byEvidence('component-css'), ...unproven].map(r => r.class))
  if (covered.size !== rows.length)
    out.push(`    ✗ внутренняя ошибка измерителя: корзины покрывают ${covered.size} из ${rows.length} классов`)
  out.push('')
}

function printSafelist(out, safelist, stand) {
  if (!safelist) {
    out.push('SAFELIST', '', `  паспорта нет (${stand.app}/dist/bench-meta.json), метрика пропущена`, '')
    return
  }
  out.push(`SAFELIST   bench-meta.json · ${stand.meta.components.length} компонент(ов) · ${safelist.entries} записей`, '')
  out.push(`  ${padEnd('не дали CSS вовсе', 26)}${pad(safelist.dead.length, 4)}   ${safelist.dead.join(' ')}${safelist.dead.length > 0 ? '   ← дефект' : ''}`)
  out.push(`  ${padEnd('дали CSS, доказаны', 26)}${pad(safelist.proven.length, 4)}`)
  out.push(`  ${padEnd('дали CSS, не доказаны', 26)}${pad(safelist.unproven.length, 4)}   ${safelist.unproven.join(' ')}`)
  out.push(`  ${padEnd('дублируют файловый скан', 26)}${pad(safelist.redundantWithScan.length, 4)}   ${safelist.redundantWithScan.join(' ')}`)
  out.push('')
  out.push('  «не доказано» — это НЕ «не нужно». Класс, собираемый как `p-${n}`,')
  out.push('  в бандле целой строкой не встречается физически. Доказательством')
  out.push('  считается только целый токен в HTML или в строковом литерале JS.')
  out.push('')
}

// ---------------------------------------------------------------------------
// Строгая сверка
// ---------------------------------------------------------------------------

async function loadExpectations(app) {
  const file = join(ROOT, 'apps', app, 'expected-budget.mjs')
  if (!existsSync(file))
    return null
  return (await import(pathToFileURL(file).href)).default
}

function sameSet(a, b) {
  const x = [...new Set(a)].sort()
  const y = [...new Set(b)].sort()
  return x.length === y.length && x.every((v, i) => v === y[i])
}

function strictCheck(expected, report) {
  const checks = []
  const push = (name, ok, actual, want) => checks.push({ name, ok, actual, want })

  if (expected.safelist && report.safelist) {
    push('safelist.deadEntries', sameSet(expected.safelist.deadEntries ?? [], report.safelist.dead), report.safelist.dead, expected.safelist.deadEntries ?? [])
    push('safelist.unproven', sameSet(expected.safelist.unproven ?? [], report.safelist.unproven), report.safelist.unproven, expected.safelist.unproven ?? [])
    push('safelist.redundantWithScan', sameSet(expected.safelist.redundantWithScan ?? [], report.safelist.redundantWithScan), report.safelist.redundantWithScan, expected.safelist.redundantWithScan ?? [])
  }
  if (expected.tokens) {
    push('tokens.undeclaredNoFallback', sameSet(expected.tokens.undeclaredNoFallback ?? [], report.tokens.undeclaredNoFallback), report.tokens.undeclaredNoFallback, expected.tokens.undeclaredNoFallback ?? [])
    if (expected.tokens.maxUnused !== undefined)
      push('tokens.maxUnused', report.tokens.unused.length <= expected.tokens.maxUnused, report.tokens.unused.length, `<= ${expected.tokens.maxUnused}`)
    if (expected.tokens.minChannels !== undefined) {
      const nonEmpty = Object.values(report.tokens.channels).filter(v => v.length > 0).length
      push('tokens.minChannels', nonEmpty >= expected.tokens.minChannels, nonEmpty, `>= ${expected.tokens.minChannels}`)
    }
  }
  if (expected.assets?.roles)
    push('assets.roles', sameSet(expected.assets.roles, Object.keys(report.roles)), Object.keys(report.roles), expected.assets.roles)

  return checks
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(argv, io) {
  const { flags, named } = parseArgs(argv)
  const standName = named.get('--stand') ?? 'bench-one'
  const baselineName = named.get('--baseline') ?? (standName === 'bench-one' ? 'bench-zero' : undefined)
  const prefix = named.get('--prefix') ?? 'xh'
  const top = Number(named.get('--top') ?? 20)

  const stand = readStand(standName)
  const baseline = baselineName && existsSync(join(ROOT, 'apps', baselineName, 'dist')) ? readStand(baselineName) : null

  const tokens = analyzeTokens(stand, prefix)
  const classes = analyzeClasses(stand)
  const safelist = analyzeSafelist(stand, classes)

  const report = {
    generatedAt: new Date().toISOString(),
    env: { node: process.version, platform: process.platform, arch: process.arch },
    stand: standName,
    baseline: baselineName ?? null,
    subjectPrefix: prefix,
    assets: stand.assets.map(({ text, ...rest }) => rest),
    roles: rolesOf(stand),
    tokens,
    classes: classes.rows,
    safelist,
  }

  const expected = await loadExpectations(standName)
  const checks = expected ? strictCheck(expected, report) : []
  report.strict = { checked: checks.length, failures: checks.filter(c => !c.ok) }

  if (flags.has('--json')) {
    io.stdout(`${JSON.stringify(report, null, 2)}\n`)
    return report.strict.failures.length > 0 && flags.has('--strict') ? 1 : 0
  }

  const out = []
  out.push(`Бюджет CSS/JS — ${standName}${baseline ? ` против ${baseline.app}` : ''}`)
  out.push(`${process.version} · ${process.platform}/${process.arch}`)
  out.push('Числа gzip/brotli сопоставимы ВНУТРИ прогона; между машинами zlib расходится.')
  out.push('')
  printAssets(out, stand)
  printRoles(out, stand, baseline)
  printTokens(out, tokens, top)
  printClasses(out, classes)
  printSafelist(out, safelist, stand)

  if (expected) {
    out.push('СВЕРКА С expected-budget.mjs', '')
    for (const check of checks) {
      out.push(check.ok
        ? `  ✓ ${padEnd(check.name, 30)} совпало`
        : `  ✗ ${padEnd(check.name, 30)} получили [${check.actual}], ждали [${check.want}]`)
    }
    out.push('')
    out.push(report.strict.failures.length === 0
      ? `✓ ${checks.length} строгих проверок — расхождений нет.`
      : `✗ расхождений: ${report.strict.failures.length} из ${checks.length}.`)
  }
  else {
    out.push('Файла expected-budget.mjs нет — строгая сверка пропущена.')
  }

  io.stdout(`${out.join('\n')}\n`)
  return flags.has('--strict') && report.strict.failures.length > 0 ? 1 : 0
}

const io = { stdout: text => void process.stdout.write(text), stderr: text => void process.stderr.write(text) }

main(process.argv.slice(2), io)
  .then((code) => { process.exitCode = code })
  .catch((error) => {
    io.stderr(`${error instanceof BudgetError ? error.message : (error?.stack ?? error)}\n`)
    process.exitCode = 1
  })
