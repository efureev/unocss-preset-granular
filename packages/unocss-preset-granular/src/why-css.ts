import type { GranularProvider } from './contract'

import type { PresetGranularNodeOptions } from './preset.node'
import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { resolveScanExtensions } from './fs/buildContentFilesystem'
import { readCss, resolveComponentCssFile } from './fs/readCss'
import { inspectGranularScanDirs, resolveGranularNode } from './preset.node'

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

/**
 * Канал, которым класс попадает в итоговый CSS:
 *   - `safelist` — компонент объявил его в `safelist`, генератор выдаст утилиту
 *     всегда, даже если класса нет ни в одном исходнике;
 *   - `component-css` — класс встречается СЕЛЕКТОРОМ в CSS-файле компонента,
 *     то есть приезжает готовым правилом, а не утилитой;
 *   - `source-scan` — класс найден в исходниках компонента, попадающих в
 *     `content.filesystem`; утилиту сгенерирует extractor.
 */
export type WhyCssVia = 'safelist' | 'component-css' | 'source-scan'

export interface WhyCssHit {
  via: WhyCssVia
  providerId: string
  componentName: string
  /** Файл-источник (для `component-css` и `source-scan`). */
  file?: string
}

export interface WhyCssReport {
  className: string
  /** Все найденные источники, в порядке `safelist` → `component-css` → `source-scan`. */
  hits: WhyCssHit[]
  /** Сколько файлов реально прочитано — охват ответа. */
  scanned: { cssFiles: number, sourceFiles: number, dirs: number }
  /** `true`, если найден хотя бы один источник. */
  found: boolean
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Ищет класс СЕЛЕКТОРОМ в CSS.
 *
 * В CSS спецсимволы имени класса экранируются обратным слэшем
 * (`.w-\[10px\]`, `.hover\:bg-red`), поэтому перед поиском все `\x`
 * схлопываются в `x`: сравнивать проще с «разэкранированным» текстом, чем
 * строить регулярку под каждый вариант экранирования.
 */
function cssContainsClass(css: string, className: string): boolean {
  const unescaped = css.replace(/\\(.)/g, '$1')
  return new RegExp(`\\.${escapeRegExp(className)}(?![\\w-])`).test(unescaped)
}

/**
 * Ищет класс как самостоятельный токен в исходнике — так же, как его увидел бы
 * extractor UnoCSS: по границам, чтобы `btn` не находился внутри `btn-primary`.
 */
function sourceContainsClass(source: string, className: string): boolean {
  return new RegExp(`(?<![\\w-])${escapeRegExp(className)}(?![\\w-])`).test(source)
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

/** Файлы директории (рекурсивно), отфильтрованные по расширениям скана. */
async function listSourceFiles(dir: string, extensions: readonly string[]): Promise<string[]> {
  const allowed = new Set(extensions.map(e => `.${e}`))
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true })
    return entries
      .filter(e => e.isFile() && allowed.has(extname(e.name)))
      .map(e => join(e.parentPath, e.name))
  }
  catch {
    // Директория исчезла между инспекцией и чтением — не повод падать в
    // диагностическом инструменте.
    return []
  }
}

/**
 * Отвечает на вопрос «какой компонент притащил этот класс в итоговый CSS».
 *
 * Проверяются все три канала, которыми класс может туда попасть (см.
 * {@link WhyCssVia}), и по каждому возвращается компонент-источник. Ответ не
 * закрывает один случай: класс, сгенерированный `rules`/`shortcuts` самого
 * UnoCSS или провайдера, компоненту не принадлежит вовсе — тогда список
 * источников будет пуст.
 */
export async function granularWhyCss(
  options: PresetGranularNodeOptions,
  className: string,
): Promise<WhyCssReport> {
  const resolution = resolveGranularNode(options)
  const hits: WhyCssHit[] = []

  // 1. safelist компонентов.
  for (const { provider, descriptor } of resolution.resolved.entries) {
    if (descriptor.safelist?.includes(className))
      hits.push({ via: 'safelist', providerId: provider.id, componentName: descriptor.name })
  }

  // 2. CSS-файлы компонентов. Резолвятся так же, как их читает node-слой
  //    (с fallback на `cssFileAssetNames` от `packageBaseUrl`).
  const providerById = new Map<string, GranularProvider>(
    resolution.resolved.providers.map(p => [p.id, p]),
  )
  const cssResults = await Promise.all(
    resolution.cssFiles.map(async ({ providerId, componentName, url, assetName }) => {
      const provider = providerById.get(providerId)
      if (!provider)
        return undefined
      try {
        const file = await resolveComponentCssFile(url, provider.packageBaseUrl, assetName)
        const css = await readCss(file)
        return cssContainsClass(css, className)
          ? { via: 'component-css' as const, providerId, componentName, file }
          : undefined
      }
      catch {
        // Нечитаемый CSS — это отдельная проблема (её показывает сборка
        // через `GranularCssReadError`), а не ответ на вопрос про класс.
        return undefined
      }
    }),
  )
  const cssFilesScanned = cssResults.length
  for (const hit of cssResults) {
    if (hit)
      hits.push(hit)
  }

  // 3. Исходники в скан-директориях — ровно те файлы, которые видит extractor.
  const scan = options.scan ?? {}
  const dirs = inspectGranularScanDirs(options).dirs
  const extensions = resolveScanExtensions(scan)

  let sourceFilesScanned = 0
  for (const dir of dirs) {
    const files = await listSourceFiles(dir.dir, extensions)
    sourceFilesScanned += files.length
    const found = await Promise.all(files.map(async (file) => {
      try {
        // Намеренно `readFile`, а не `readCss`: тот кэширует прочитанное, и
        // исходники компонентов вытеснили бы из LRU реально горячий CSS.
        return sourceContainsClass(await readFile(file, 'utf8'), className) ? file : undefined
      }
      catch {
        return undefined
      }
    }))
    for (const file of found) {
      if (file) {
        hits.push({
          via: 'source-scan',
          providerId: dir.providerId,
          componentName: dir.componentName,
          file,
        })
      }
    }
  }

  return {
    className,
    hits,
    scanned: { cssFiles: cssFilesScanned, sourceFiles: sourceFilesScanned, dirs: dirs.length },
    found: hits.length > 0,
  }
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

const VIA_TEXT: Record<WhyCssVia, string> = {
  'safelist': 'component safelist (the utility is always emitted)',
  'component-css': 'selector in a component CSS file',
  'source-scan': 'component source in content.filesystem',
}

/** Рендерит {@link WhyCssReport} в человекочитаемый многострочный текст. */
export function formatWhyCssReport(report: WhyCssReport, cwd: string): string {
  const lines: string[] = []
  const push = (s = ''): void => void lines.push(s)
  const short = (file: string): string => {
    const rel = relative(cwd, file)
    return rel && !rel.startsWith('..') ? rel : file
  }

  push(`granular why-css ${report.className}`)
  push('='.repeat(`granular why-css ${report.className}`.length))
  push()

  if (!report.found) {
    push(`No sources found (scanned: ${report.scanned.cssFiles} CSS file(s), `
      + `${report.scanned.sourceFiles} source file(s) in ${report.scanned.dirs} director(ies)).`)
    push()
    push('The class may come from outside any component: from rules/shortcuts of')
    push('UnoCSS itself or a provider (provider.unocss), from base/tokens/theme CSS,')
    push('or from the application code — granular does not track those.')
    return lines.join('\n')
  }

  const byVia = new Map<WhyCssVia, WhyCssHit[]>()
  for (const hit of report.hits) {
    const list = byVia.get(hit.via) ?? []
    list.push(hit)
    byVia.set(hit.via, list)
  }

  push(`Sources (${report.hits.length}):`)
  for (const [via, list] of byVia) {
    push(`  ${VIA_TEXT[via]}:`)
    for (const hit of list)
      push(`    • ${hit.providerId}:${hit.componentName}${hit.file ? ` — ${short(hit.file)}` : ''}`)
  }
  push()
  push(`Scanned: ${report.scanned.cssFiles} CSS file(s), `
    + `${report.scanned.sourceFiles} source file(s) in ${report.scanned.dirs} director(ies).`)

  return lines.join('\n')
}
