import type { InlinedCssKind } from './node-utils/inlinedCss'
import type { GranularPruneMode, TokenKeepReason } from './node-utils/tokenPrune'
import type { PresetGranularNodeOptions } from './preset.node'

import { Buffer } from 'node:buffer'
import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isCssDataUrl, readCss, resolveCssFilePath } from './fs/readCss'
import { scanCssDeclarations } from './node-utils/cssDeclarations'
import { resolveInlinedCssSources } from './node-utils/inlinedCss'
import { pruneCssDeclarations } from './node-utils/pruneCssDeclarations'
import { planGranularTokenPrune } from './node-utils/tokenPrune'
import { getGranularComponentCssFiles, inspectGranularScanDirs, resolveGranularNode } from './preset.node'

/** Что обрезка сделала бы с одним инлайнимым файлом. */
export interface TokenPruneFileReport {
  url: string
  kind: InlinedCssKind
  origin: string
  theme?: string
  /** Файл не обрезается по построению (`base`). */
  skipped: boolean
  declared: number
  kept: number
  removed: number
  bytesBefore: number
  bytesAfter: number
}

/** Один сохранённый токен и причина. */
export interface TokenPruneKept {
  token: string
  reason: TokenKeepReason
}

/**
 * Токен, который обрезка удаляет, хотя его имя лежит строковым литералом
 * где-то в `dist` пакета — вне скан-директорий.
 *
 * Это ровно тот случай, в котором обрезка ломается молча: имя собирается в
 * рантайме из общего модуля, статический канал его увидеть не может, а
 * объявления `dynamicTokens` у компонента нет. Находка не удерживает токен —
 * она делает громким то, что иначе прошло бы незамеченным.
 */
export interface TokenPruneSuspect {
  token: string
  /** Файл, где нашлось имя (относительно корня пакета). */
  file: string
}

export interface TokenPruneReport {
  mode: GranularPruneMode
  /** Провайдеры, на которых считался вердикт. */
  providers: string[]
  themes: string[]
  files: TokenPruneFileReport[]
  kept: TokenPruneKept[]
  removed: string[]
  /** Сколько файлов приложения прочитал скан `appSources`. */
  appSourcesScanned: number
  /** Удаляемые токены, чьё имя встречается литералом вне скан-директорий. */
  suspects: TokenPruneSuspect[]
  /**
   * Шаблоны `keep` / `keepPrefixes` / `dynamicTokens`, не совпавшие ни с одним
   * объявленным токеном: опечатка либо протухшая строка.
   */
  deadPatterns: string[]
  bytesBefore: number
  bytesAfter: number
}

/**
 * Что обрезка удалит и что сохранит — без изменения эмиссии.
 *
 * Отдельная команда, а не поле `doctor`: доктор — инструмент КОРРЕКТНОСТИ, и
 * вшитая в него обрезка заставила бы `--strict` в чужом CI падать из-за
 * мнения о размере. И не поле `granular tokens`: тот отвечает на
 * покомпонентный вопрос, а обрезка — факт про сборку целиком.
 */
export async function granularTokenPrune(
  options: PresetGranularNodeOptions,
): Promise<TokenPruneReport> {
  const resolution = resolveGranularNode(options)
  const sources = resolveInlinedCssSources(resolution.providers, resolution.themes.items, options.themes)

  const inlined = await Promise.all(sources.map(async source => ({
    source,
    css: await readCss(resolveCssFilePath(source.url)),
  })))

  const componentFiles = await getGranularComponentCssFiles(options)
  const componentCss = await Promise.all(componentFiles.map(file => readCss(resolveCssFilePath(file))))

  const plan = planGranularTokenPrune(
    options,
    resolution,
    inspectGranularScanDirs(options).dirs,
    { inlined, componentCss },
  )

  const files: TokenPruneFileReport[] = []
  let bytesBefore = 0
  let bytesAfter = 0

  for (const section of inlined) {
    const skipped = section.source.kind === 'base'
    const result = skipped
      ? { css: section.css, removed: [] as string[] }
      : pruneCssDeclarations(section.css, plan.isKept)
    const before = Buffer.byteLength(section.css)
    const after = Buffer.byteLength(result.css)
    bytesBefore += before
    bytesAfter += after

    // Имена считает ТОТ ЖЕ сканер, что и обрезка. Регулярка здесь врала бы:
    // `--x /* комментарий */: v` она не видит, и «объявлено» расходилось с
    // суммой «сохранено + удалено».
    const declaredNames = new Set(scanCssDeclarations(section.css).map(decl => decl.token))

    files.push({
      url: section.source.url,
      kind: section.source.kind,
      origin: section.source.origin,
      ...(section.source.theme === undefined ? {} : { theme: section.source.theme }),
      skipped,
      declared: declaredNames.size,
      kept: [...declaredNames].filter(plan.isKept).length,
      removed: result.removed.length,
      bytesBefore: before,
      bytesAfter: after,
    })
  }

  return {
    mode: plan.mode,
    providers: resolution.providers.map(p => p.id),
    themes: [...resolution.themes.names],
    files,
    kept: [...plan.kept].map(([token, reason]) => ({ token, reason })).sort((a, b) => a.token.localeCompare(b.token)),
    removed: [...plan.removable],
    appSourcesScanned: plan.appSourcesScanned,
    deadPatterns: [...plan.deadPatterns],
    suspects: findSuspects(
      resolution.providers,
      plan.removable,
      new Set(inspectGranularScanDirs(options).dirs.map(d => d.dir)),
    ),
    bytesBefore,
    bytesAfter,
  }
}

const CODE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx', '.vue'])
const LITERAL_RE = /(['"`])(--[\w-]+)\1/g

/**
 * Признак того, что файл СОБИРАЕТ `var()` в рантайме, а не просто перечисляет
 * имена токенов.
 *
 * Без этого условия проверка бесполезна: у дизайн-системы обычно есть
 * TS-зеркало реестра токенов, где каждое имя лежит строкой, и находкой
 * становится КАЖДЫЙ удаляемый токен. Измерено на `@feugene/granularity`:
 * 195 срабатываний из 195 удаляемых, все на `chunks/generated-*.js` — зеркале
 * `src/tokens/generated.ts`. С этим условием там остаются только настоящие
 * два файла.
 *
 * Ловятся обе формы: шаблонная (`` `var(${x})` ``, как в неминифицированной
 * сборке) и склейка (`"var(" + x`, во что её превращает минификатор).
 */
const DYNAMIC_ASSEMBLY_RE = /var\(\$\{|(['"`])var\(\1/

/**
 * Ищет имена удаляемых токенов в коде пакета ЗА пределами скан-директорий.
 *
 * Скан пресета читает только `components/<Name>/**` и `groups/<g>/shared/`.
 * Модуль, который бандлер вынес в общий чанк (типичная судьба композабла,
 * используемого несколькими компонентами), туда не попадает — и если имя
 * токена собирается именно там, ни один статический канал его не найдёт.
 *
 * Находкой считается имя, встреченное в файле, который ТУТ ЖЕ собирает
 * `var()` динамически. Одного имени мало — см. {@link DYNAMIC_ASSEMBLY_RE}.
 *
 * Проверка диагностическая: она ничего не удерживает, а подсказывает, у
 * какого компонента не хватает `dynamicTokens`.
 */
function findSuspects(
  providers: readonly { packageBaseUrl: string }[],
  removed: readonly string[],
  scanned: ReadonlySet<string>,
): TokenPruneSuspect[] {
  if (removed.length === 0)
    return []

  const wanted = new Set(removed)
  const found = new Map<string, string>()

  for (const provider of providers) {
    let root: string
    try {
      root = fileURLToPath(provider.packageBaseUrl)
    }
    catch {
      continue
    }

    let entries
    try {
      entries = readdirSync(root, { recursive: true, withFileTypes: true })
    }
    catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isFile())
        continue
      const dir = entry.parentPath
      // Директории, которые пресет и так читает, здесь не интересны: всё
      // найденное в них уже учтено каналами потребления.
      if ([...scanned].some(scanDir => dir.startsWith(scanDir)))
        continue
      const file = join(dir, entry.name)
      // `.d.ts` — объявления типов, там имя токена ничего не потребляет.
      if (!CODE_EXTENSIONS.has(extname(entry.name)) || entry.name.endsWith('.d.ts'))
        continue

      let text: string
      try {
        text = readFileSync(file, 'utf8')
      }
      catch {
        continue
      }
      if (!DYNAMIC_ASSEMBLY_RE.test(text))
        continue

      for (const match of text.matchAll(LITERAL_RE)) {
        const token = (match[2] as string).slice(2)
        if (wanted.has(token) && !found.has(token))
          found.set(token, relative(root, file))
      }
    }
  }

  return [...found].map(([token, file]) => ({ token, file })).sort((a, b) => a.token.localeCompare(b.token))
}

const REASON_TITLE: Record<TokenKeepReason['kind'], string> = {
  'usage': 'consumed by a selected component',
  'inlined-rule': 'used by rules of the inlined CSS',
  'component-css': 'used by a component CSS file',
  'override': 'targeted by themes.tokenOverrides',
  'structural': 'declared by a structural theme layer',
  'app-source': 'found in the application sources',
  'keep-pattern': 'kept by pattern',
  'referenced-by': 'referenced by another kept token',
}

const REASON_ORDER: Array<TokenKeepReason['kind']> = [
  'usage',
  'component-css',
  'inlined-rule',
  'app-source',
  'override',
  'structural',
  'keep-pattern',
  'referenced-by',
]

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} kB`
}

function shorten(url: string, cwd: string): string {
  // `data:`-URL печатать целиком бессмысленно: это base64 всего файла.
  // Провайдер, объявивший фундамент литералом `new URL(...)`, получает от
  // бандлера именно такую ссылку — и по ней его как раз и опознают.
  if (isCssDataUrl(url))
    return `<inlined data: URL, ${url.length} chars>`
  if (!url.startsWith('file:'))
    return url.length > 80 ? `${url.slice(0, 77)}…` : url
  try {
    const path = resolveCssFilePath(url)
    const rel = relative(cwd, path)
    return rel.startsWith('..') ? path : rel
  }
  catch {
    return url
  }
}

/** Человекочитаемый отчёт. Строки — по-английски, как у остальных команд. */
export function formatTokenPruneReport(report: TokenPruneReport, cwd: string): string {
  const lines: string[] = []
  lines.push('granular prune', '='.repeat(14), '')
  lines.push(`Mode: ${report.mode}`)
  if (report.mode === 'off') {
    // Иначе список «Removed» читается как отчёт о сделанном.
    lines.push('  (trimming is disabled — everything below is what it WOULD do;')
    lines.push('   enable it with pruneTokens.mode in the preset options)')
  }
  lines.push(`Providers: ${report.providers.join(', ')}`)
  lines.push(`Themes: ${report.themes.length > 0 ? report.themes.join(', ') : '—'}`)
  lines.push('')

  lines.push(`Files (${report.files.length}):`)
  for (const file of report.files) {
    const where = `${file.origin} — ${shorten(file.url, cwd)}${file.theme ? ` [${file.theme}]` : ''}`
    if (file.skipped) {
      lines.push(`  • ${where} — not pruned (${file.kind}: rules, not declarations)`)
      continue
    }
    lines.push(
      `  • ${where} — ${file.declared} declared, ${file.kept} kept, ${file.removed} removed`
      + `   ${kb(file.bytesBefore)} → ${kb(file.bytesAfter)}`,
    )
  }
  lines.push('')

  const byReason = new Map<TokenKeepReason['kind'], TokenPruneKept[]>()
  for (const entry of report.kept) {
    const bucket = byReason.get(entry.reason.kind) ?? []
    bucket.push(entry)
    byReason.set(entry.reason.kind, bucket)
  }

  lines.push(`Kept (${report.kept.length}):`)
  for (const kind of REASON_ORDER) {
    const bucket = byReason.get(kind)
    if (!bucket || bucket.length === 0)
      continue
    lines.push(`  ${REASON_TITLE[kind]} (${bucket.length}):`)
    for (const entry of bucket.slice(0, 12)) {
      const detail = entry.reason.kind === 'referenced-by'
        ? `  ← --${entry.reason.by}`
        : entry.reason.kind === 'keep-pattern'
          ? `  (${entry.reason.pattern})`
          : ''
      lines.push(`    • --${entry.token}${detail}`)
    }
    if (bucket.length > 12)
      lines.push(`    … and ${bucket.length - 12} more`)
  }
  lines.push('')

  lines.push(`Removed (${report.removed.length}):`)
  lines.push(report.removed.length > 0 ? `  ${report.removed.map(t => `--${t}`).join(' ')}` : '  —')
  lines.push('')

  if (report.deadPatterns.length > 0) {
    lines.push(`⚠ Patterns matching nothing declared (${report.deadPatterns.length}):`)
    for (const pattern of report.deadPatterns)
      lines.push(`    • ${pattern}`)
    lines.push('  A typo, or a line left behind after the component stopped assembling')
    lines.push('  the name at runtime. Harmless on its own — which is why it rots quietly.')
    lines.push('')
  }

  if (report.suspects.length > 0) {
    lines.push(`⚠ Removed, but the name appears as a literal outside the scanned directories (${report.suspects.length}):`)
    for (const suspect of report.suspects)
      lines.push(`    • --${suspect.token}  ${suspect.file}`)
    lines.push('  The name is most likely assembled at runtime there. No static channel can')
    lines.push('  see it — declare it in `dynamicTokens` of the component that reads it.')
    lines.push('')
  }

  const saved = report.bytesBefore - report.bytesAfter
  const pct = report.bytesBefore === 0 ? 0 : Math.round((saved / report.bytesBefore) * 100)
  lines.push(`Total: ${kb(report.bytesBefore)} → ${kb(report.bytesAfter)} (-${pct}%).`)

  // Строка обязательна: она честно говорит, на каком объёме улик построено
  // решение. Обрезка при ненастроенном скане приложения — самый частый способ
  // потерять токен, который приложение взяло само.
  lines.push(report.appSourcesScanned > 0
    ? `Application sources: ${report.appSourcesScanned} file(s) scanned.`
    : 'Application sources: not configured — the preset did not read a single file of this application.')

  return lines.join('\n')
}
