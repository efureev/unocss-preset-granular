import type { GranularProvider } from '../contract'
import type { PresetGranularResolution } from '../preset'
import type { PresetGranularNodeOptions } from '../preset.node'

import type { ResolvedScanDir } from './resolveScanDirs'

import { readdirSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { resolveScanExtensions } from './buildContentFilesystem'
import { readCssSync, resolveComponentCssFileSync } from './readCss'
import { canonicalize, componentDirPath, groupSharedDirPath } from './resolveScanDirs'

/**
 * Канал, которым потребление токена стало видимым. Порядок — по убыванию
 * надёжности; тот же принцип, что у `WhyCssVia`.
 *
 *   - `safelist` — токен стоит в `descriptor.safelist`. Чистые данные
 *     резолюции: ни чтения файлов, ни эвристики.
 *   - `component-css` — токен встречается в объявленном `cssFiles`.
 *   - `source-scan` — токен найден в исходниках компонента, попадающих в
 *     `content.filesystem`. Разбор текстовый, см. оговорки ниже.
 */
export type TokenUsageVia = 'safelist' | 'component-css' | 'source-scan'

/** Потребление одного токена одним компонентом. */
export interface ComponentTokenUsage {
  via: TokenUsageVia[]
  /** Файлы, где найдено (пусто для канала `safelist`). */
  files: string[]
  /** Хотя бы одно потребление записано как `var(--x, …)`. */
  hasFallback: boolean
}

/**
 * Внутренняя форма записи: множества вместо массивов.
 *
 * Дедуп через `Array.includes` делал построение индекса квадратичным по числу
 * файлов, в которых встречается токен, — а частотный токен дизайн-системы
 * попадает в тысячи файлов, и всё это внутри синхронного `doctor`.
 */
interface UsageAccumulator {
  via: Set<TokenUsageVia>
  files: Set<string>
  hasFallback: boolean
}

export interface TokenUsageIndex {
  /** Токен (без `--`) → ключ компонента → как найдено. */
  usage: Map<string, Map<string, ComponentTokenUsage>>
  scanned: { safelist: number, cssFiles: number, sourceFiles: number, dirs: number }
  /** `false`, если скан исходников выключен или все директории отфильтрованы. */
  sourceScanActive: boolean
}

/**
 * Потребление CSS-переменной.
 *
 * Ищется текст `var(--NAME` независимо от того, где он лежит: в CSS, в
 * атрибуте шаблона, в строковом литерале собранного чанка или внутри
 * arbitrary-значения UnoCSS (`bg-[var(--x)]`). Класс символов имени — тот же,
 * что у `DECL_RE` в `tokenDefinitionsFromCss`: объявление и потребление
 * обязаны читать одно и то же имя.
 *
 * Вложенные `var(--a, var(--b))` находятся оба: глобальный поиск идёт по
 * каждому вхождению `var(` отдельно, поэтому балансировать скобки ради ИМЕНИ
 * не нужно.
 *
 * Наличие fallback фиксируется как факт (запятая после имени), но не
 * разбирается: разобранный fallback стал бы третьим понятием «значения по
 * умолчанию», конкурирующим с двумя настоящими слоями, а в arbitrary-значениях
 * UnoCSS он ещё и записан не как CSS.
 */
const VAR_USE_RE = /var\(\s*--([\w-]+)\s*(,)?/g

/** Имена токенов и признак fallback из произвольного текста. */
function extractTokenUses(text: string): Map<string, boolean> {
  const found = new Map<string, boolean>()
  VAR_USE_RE.lastIndex = 0
  let match = VAR_USE_RE.exec(text)
  while (match !== null) {
    const name = match[1]
    found.set(name, (found.get(name) ?? false) || match[2] !== undefined)
    match = VAR_USE_RE.exec(text)
  }
  return found
}

/**
 * В CSS спецсимволы имени класса экранируются (`.bg-\[var\(--x\)\]`), поэтому
 * перед поиском все `\x` схлопываются в `x` — ровно как в `why-css`.
 */
function unescapeCss(css: string): string {
  return css.replace(/\\(.)/g, '$1')
}

/** Файлы директории (рекурсивно), отфильтрованные по расширениям скана. */
function listSourceFilesSync(dir: string, extensions: readonly string[]): string[] {
  const allowed = new Set(extensions.map(e => `.${e}`))
  try {
    return readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter(e => e.isFile() && allowed.has(extname(e.name)))
      .map(e => join(e.parentPath, e.name))
  }
  catch {
    // Директория исчезла между инспекцией и чтением — не повод падать
    // в диагностическом инструменте.
    return []
  }
}

const usageCache = new WeakMap<PresetGranularNodeOptions, TokenUsageIndex>()

/**
 * Строит индекс «какой компонент какой токен потребляет» по всем ВЫБРАННЫМ
 * компонентам за один проход.
 *
 * Один проход обслуживает и запрошенный компонент, и вопрос «кого ещё заденет
 * правка этого токена»: маргинальная стоимость второго — ноль дополнительных
 * чтений, поэтому разделяемость считается всегда, а не под флагом.
 *
 * Мемоизируется по идентичности `options` — шестой кэш пресета, тот же
 * контракт, что у остальных пяти.
 */
export function inspectGranularTokenUsage(
  options: PresetGranularNodeOptions,
  resolution: PresetGranularResolution,
  scanDirs: readonly ResolvedScanDir[],
): TokenUsageIndex {
  const cached = usageCache.get(options)
  if (cached)
    return cached

  const acc = new Map<string, Map<string, UsageAccumulator>>()
  const scanned = { safelist: 0, cssFiles: 0, sourceFiles: 0, dirs: 0 }

  const record = (token: string, componentKey: string, via: TokenUsageVia, file: string | undefined, hasFallback: boolean): void => {
    let byComponent = acc.get(token)
    if (!byComponent) {
      byComponent = new Map()
      acc.set(token, byComponent)
    }
    let entry = byComponent.get(componentKey)
    if (!entry) {
      entry = { via: new Set(), files: new Set(), hasFallback: false }
      byComponent.set(componentKey, entry)
    }
    entry.via.add(via)
    if (file !== undefined)
      entry.files.add(file)
    entry.hasFallback = entry.hasFallback || hasFallback
  }

  // 1. safelist — чистые данные резолюции.
  //
  // Канал обязателен, а не желателен: классы, собранные вне директории
  // компонента (общий чанк), extractor не видит, поэтому компонент обязан
  // объявить их в safelist — и тогда это единственное место, где его токены
  // вообще записаны.
  const providerById = new Map<string, GranularProvider>()
  for (const { provider, descriptor } of resolution.resolved.entries) {
    providerById.set(provider.id, provider)
    const key = `${provider.id}:${descriptor.name}`
    for (const klass of descriptor.safelist ?? []) {
      scanned.safelist++
      for (const [token, hasFallback] of extractTokenUses(klass))
        record(token, key, 'safelist', undefined, hasFallback)
    }
  }

  // 2. Объявленные CSS-файлы компонентов.
  //
  // `resolution.cssFiles` дедуплицирован по URL и хранит только ПЕРВОГО
  // объявителя, поэтому владельцев файла восстанавливаем по дескрипторам: файл,
  // объявленный двумя компонентами, принадлежит обоим, и приписать его одному
  // значило бы скрыть потребление второго.
  const cssOwners = new Map<string, string[]>()
  for (const { provider, descriptor } of resolution.resolved.entries) {
    for (const url of descriptor.cssFiles ?? []) {
      const owners = cssOwners.get(url)
      const key = `${provider.id}:${descriptor.name}`
      if (owners)
        owners.push(key)
      else
        cssOwners.set(url, [key])
    }
  }

  for (const { providerId, url, assetName } of resolution.cssFiles) {
    const provider = providerById.get(providerId)
    if (!provider)
      continue
    try {
      const file = resolveComponentCssFileSync(url, provider.packageBaseUrl, assetName)
      const css = unescapeCss(readCssSync(file))
      scanned.cssFiles++
      const uses = extractTokenUses(css)
      for (const owner of cssOwners.get(url) ?? []) {
        for (const [token, hasFallback] of uses)
          record(token, owner, 'component-css', file, hasFallback)
      }
    }
    catch {
      // Нечитаемый CSS — отдельная проблема, её показывает сборка через
      // `GranularCssReadError`, а не ответ на вопрос про токены.
    }
  }

  // 3. Исходники компонентов.
  //
  // Директории считаются по layout-контракту для КАЖДОГО компонента, а не
  // фильтрацией общего списка скан-директорий: тот дедуплицирован по
  // каноническому пути, поэтому `groups/<g>/shared/` приписан лишь ПЕРВОМУ
  // резолвнутому члену группы. Здесь shared-директория приписывается каждому
  // члену группы — и это верно: общий SFC входит в код каждого из них, а
  // дедуп в `resolveComponentScanDirs` существует ради того, чтобы UnoCSS не
  // сканировал папку дважды, а не ради принадлежности.
  const scannable = new Set(scanDirs.map(d => d.dir))
  const extensions = resolveScanExtensions(options.scan ?? {})
  const visited = new Map<string, Array<[file: string, uses: Map<string, boolean>]>>()

  for (const { provider, descriptor } of resolution.resolved.entries) {
    const key = `${provider.id}:${descriptor.name}`
    const dirs: string[] = []
    try {
      dirs.push(canonicalize(componentDirPath(provider.packageBaseUrl, descriptor.name)))
    }
    catch {
      continue
    }
    if (typeof descriptor.group === 'string' && descriptor.group.length > 0) {
      try {
        dirs.push(canonicalize(groupSharedDirPath(provider.packageBaseUrl, descriptor.group)))
      }
      catch {
        // Группа без общей директории — штатная ситуация.
      }
    }

    for (const dir of dirs) {
      // Гейт тот же, что у сборки: нет директории или нет `index.js` —
      // компонент не сканируется и здесь.
      if (!scannable.has(dir))
        continue

      // Директория читается ОДИН раз, даже когда её делят несколько
      // компонентов (`groups/<g>/shared/` входит в код каждого члена группы).
      // Иначе группа из шести членов перечитывала бы общие файлы шестикратно —
      // синхронно, внутри `granularDoctor`, — и `scanned.sourceFiles` выдавал
      // бы больше файлов, чем их существует.
      let parsed = visited.get(dir)
      if (!parsed) {
        parsed = []
        for (const file of listSourceFilesSync(dir, extensions)) {
          try {
            // Намеренно обычное чтение, а не `readCssSync`: тот кэширует, и
            // исходники компонентов вытеснили бы из LRU реально горячий CSS.
            parsed.push([file, extractTokenUses(readFileSync(file, 'utf8'))])
          }
          catch {
            continue
          }
        }
        visited.set(dir, parsed)
        scanned.dirs++
        scanned.sourceFiles += parsed.length
      }

      for (const [file, uses] of parsed) {
        for (const [token, hasFallback] of uses)
          record(token, key, 'source-scan', file, hasFallback)
      }
    }
  }

  // Множества материализуются в массивы один раз, на выходе.
  const usage = new Map<string, Map<string, ComponentTokenUsage>>()
  for (const [token, byComponent] of acc) {
    const out = new Map<string, ComponentTokenUsage>()
    for (const [component, entry] of byComponent)
      out.set(component, { via: [...entry.via], files: [...entry.files], hasFallback: entry.hasFallback })
    usage.set(token, out)
  }

  const index: TokenUsageIndex = {
    usage,
    scanned,
    sourceScanActive: scanDirs.length > 0,
  }
  usageCache.set(options, index)
  return index
}
