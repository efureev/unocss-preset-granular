#!/usr/bin/env node
/**
 * Проверяет, что собранный CSS демо-приложений содержит ровно то, ради чего
 * каждое приложение существует.
 *
 * `apps/app-1..4` — это интеграционные тесты контракта: они единственные
 * прогоняют цепочку «провайдер → пресет → UnoCSS → CSS» целиком. Но до сих
 * пор «проверкой» считалась сама успешная сборка, а она зелёная и тогда,
 * когда классы компонентов молча исчезли из вывода — ровно тот отказ, от
 * которого пресет и защищает.
 *
 * Ожидания живут рядом с приложением: `apps/<app>/expected-css.mjs`.
 *
 * Использование:
 *   node scripts/verify-apps.mjs            # все приложения
 *   node scripts/verify-apps.mjs app-3      # одно
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL, URL } from 'node:url'

const appsDir = fileURLToPath(new URL('../apps/', import.meta.url))

function listApps() {
  return readdirSync(appsDir).filter(name => statSync(join(appsDir, name)).isDirectory())
}

/** Всё, что приложение эмитит в `dist/assets` с данным расширением, одной строкой. */
function readBuiltAssets(app, ext) {
  const assetsDir = join(appsDir, app, 'dist/assets')
  let files
  try {
    files = readdirSync(assetsDir).filter(f => f.endsWith(ext))
  }
  catch {
    throw new Error(`нет '${assetsDir}'. Сначала: yarn build:all`)
  }
  if (files.length === 0)
    throw new Error(`в '${assetsDir}' нет ни одного ${ext}`)

  return files.map(f => readFileSync(join(assetsDir, f), 'utf8')).join('\n')
}

async function loadExpectations(app) {
  const file = join(appsDir, app, 'expected-css.mjs')
  try {
    const mod = await import(pathToFileURL(file).href)
    return mod.default
  }
  catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND')
      return null
    throw error
  }
}

/**
 * Сборка минифицирована, и стиль кавычек выбирает бандлер: один и тот же
 * манифест выглядит как `{"entry":"x"}` в исходнике и как `{entry:`x`}` в
 * бандле. Кавычки — не факт о сборке, поэтому из сравнения они выкидываются,
 * и ожидание можно писать в читаемом JSON-виде.
 */
function stripQuotes(text) {
  return text.replace(/["'`]/g, '')
}

/**
 * Сверяет один корпус (CSS или JS) со списками `present` / `absent`.
 *
 * Возвращает найденные расхождения и число выполненных проверок.
 */
function matchExpectations(rawHaystack, { present = [], absent = [] }, field) {
  const failures = []
  const normalize = field === 'js' ? stripQuotes : text => text
  const haystack = normalize(rawHaystack)

  for (const item of present) {
    const needle = normalize(item[field])
    if (!haystack.includes(needle))
      failures.push(`ОЖИДАЛОСЬ, но нет: ${item.what}\n      искали: ${JSON.stringify(needle)}`)
  }

  for (const item of absent) {
    const needle = normalize(item[field])
    if (haystack.includes(needle))
      failures.push(`НЕ ДОЛЖНО БЫТЬ, но есть: ${item.what}\n      нашли: ${JSON.stringify(needle)}`)
  }

  return { failures, checked: present.length + absent.length }
}

async function verifyApp(app) {
  const expectations = await loadExpectations(app)
  if (!expectations) {
    console.log(`  ${app}: пропущено — нет expected-css.mjs`)
    return { skipped: true, failures: [] }
  }

  const css = matchExpectations(readBuiltAssets(app, '.css'), expectations, 'css')
  const failures = [...css.failures]
  let total = css.checked

  // Секция `js` — для того, что CSS доказать не может: манифесты сборки,
  // отсечённые локали, содержимое ленивых чанков. Необязательна: приложения,
  // которые проверяют только стили, её не объявляют.
  if (expectations.js) {
    const js = matchExpectations(readBuiltAssets(app, '.js'), expectations.js, 'js')
    failures.push(...js.failures)
    total += js.checked
  }
  if (failures.length === 0)
    console.log(`  ✓ ${app}: ${total} проверок — ${expectations.purpose}`)
  else
    console.log(`  ✗ ${app}: ${failures.length} из ${total} — ${expectations.purpose}`)

  for (const failure of failures)
    console.log(`      • ${failure}`)

  return { skipped: false, failures }
}

const requested = process.argv.slice(2)
const apps = requested.length > 0 ? requested : listApps()

console.log(`Проверка собранной сборки (${apps.length} прил.):`)

let failed = 0
for (const app of apps) {
  try {
    const { failures } = await verifyApp(app)
    if (failures.length > 0)
      failed++
  }
  catch (error) {
    console.log(`  ✗ ${app}: ${error.message}`)
    failed++
  }
}

if (failed > 0) {
  console.log(`\n✗ Приложений с расхождениями: ${failed}.`)
  process.exitCode = 1
}
else {
  console.log('\n✓ Все ожидания выполнены.')
}
