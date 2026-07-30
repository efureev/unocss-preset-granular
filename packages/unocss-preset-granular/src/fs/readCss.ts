import { Buffer } from 'node:buffer'
import { access, readFile, stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const DATA_URL_PREFIX = 'data:text/css'

/** True, если `file` — data URL с CSS. */
export function isCssDataUrl(file: string): boolean {
  return file.startsWith(DATA_URL_PREFIX)
}

/**
 * Нормализует вход (data URL / file:// URL / другой protocol / абсолютный путь / относительный)
 * в абсолютный путь или data URL.
 */
export function resolveCssFilePath(file: string): string {
  if (isCssDataUrl(file))
    return file

  if (/^[a-z]+:\/\//i.test(file)) {
    const url = new URL(file)
    if (url.protocol === 'file:')
      return fileURLToPath(url)
    // Only `file:` URLs (and data: CSS handled above) are readable from disk.
    // Remote protocols (`http:`, `https:`, …) cannot be inlined at build time;
    // fail loudly instead of silently mapping the pathname onto `cwd`.
    throw new Error(
      `[granular] cannot read CSS from a non-file URL '${file}'. `
      + `Only local paths, 'file://' URLs and 'data:text/css' URLs are supported.`,
    )
  }

  if (isAbsolute(file))
    return file

  return resolve(process.cwd(), file)
}

function decodeCssDataUrl(file: string): string {
  const match = file.match(/^data:([^,]*),(.*)$/s)
  if (!match)
    throw new Error(`Unsupported CSS data URL: ${file.slice(0, 64)}...`)
  const [, metadata = '', body = ''] = match
  if (metadata.includes(';base64'))
    return Buffer.from(body, 'base64').toString('utf8')
  return decodeURIComponent(body)
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  }
  catch {
    return false
  }
}

interface CssCacheEntry {
  mtimeMs: number
  size: number
  content: string
}

/**
 * Верхняя граница числа записей в {@link cssCache}.
 *
 * Кэш живёт столько же, сколько процесс: в долгом `vite dev` при большом
 * числе провайдеров он рос бы монотонно и никогда не отдавал память. Записи
 * — это содержимое CSS-файлов, так что «безлимитный Map» здесь означает
 * «держим в памяти весь CSS, который когда-либо читали».
 *
 * 512 файлов с запасом покрывают любой реальный конфиг (крупный
 * дизайн-системный пакет — это десятки компонентов), а вытеснение по LRU
 * бьёт по тем файлам, которые давно не запрашивались.
 */
export const CSS_CACHE_MAX_ENTRIES = 512

/**
 * mtime+size кэш чтения CSS с диска. Один и тот же base/tokens/theme файл
 * читается пресетом многократно (по preflight-`getCSS` на каждую регенерацию
 * при HMR) — кэш отдаёт содержимое без повторного `readFile`, пока файл не
 * изменился.
 *
 * Инвалидация по (mtimeMs, size) — то есть измененный файл перечитывается
 * сам, без внешнего хука. Вытеснение — LRU по числу записей
 * ({@link CSS_CACHE_MAX_ENTRIES}); `Map` в JS сохраняет порядок вставки,
 * поэтому «самый давний» — это первый ключ итерации. Для явного сброса —
 * {@link clearCssCache}.
 */
const cssCache = new Map<string, CssCacheEntry>()

/** Сбрасывает mtime-кэш чтения CSS (полностью). */
export function clearCssCache(): void {
  cssCache.clear()
}

/** Текущее число записей в кэше — для диагностики и тестов. */
export function getCssCacheSize(): number {
  return cssCache.size
}

/** Кладёт запись, вытесняя самую давно не запрошенную при переполнении. */
function cacheSet(file: string, entry: CssCacheEntry): void {
  // Переносим ключ в конец, чтобы порядок итерации отражал «свежесть».
  cssCache.delete(file)
  cssCache.set(file, entry)

  while (cssCache.size > CSS_CACHE_MAX_ENTRIES) {
    const oldest = cssCache.keys().next()
    if (oldest.done)
      break
    cssCache.delete(oldest.value)
  }
}

/** Читает CSS либо из data URL, либо из локального файла (с mtime-кэшем). */
export async function readCss(file: string): Promise<string> {
  if (isCssDataUrl(file))
    return decodeCssDataUrl(file)

  let stats
  try {
    stats = await stat(file)
  }
  catch {
    // Не удалось получить stat — пусть readFile бросит каноническую ошибку.
    return readFile(file, 'utf8')
  }

  const cached = cssCache.get(file)
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    // Освежаем позицию в LRU — файл только что запрашивали.
    cssCache.delete(file)
    cssCache.set(file, cached)
    return cached.content
  }

  const content = await readFile(file, 'utf8')
  cacheSet(file, { mtimeMs: stats.mtimeMs, size: stats.size, content })
  return content
}

/**
 * Пробует прочитать `sourceFile`; если его нет — возвращает резолвнутое имя ассета
 * относительно `packageBaseUrl` провайдера.
 *
 * `packageBaseUrl` — URL директории пакета (НЕ конкретного модуля). Провайдер
 * обычно задаёт его через `new URL('..', import.meta.url).href`, чтобы путь
 * указывал на корень ассетов как в src, так и в dist-сборке.
 */
export async function resolveComponentCssFile(
  sourceFileUrl: string,
  packageBaseUrl: string,
  assetName: string | undefined,
): Promise<string> {
  if (isCssDataUrl(sourceFileUrl))
    return sourceFileUrl

  const sourcePath = fileURLToPath(new URL(sourceFileUrl))
  if (await fileExists(sourcePath))
    return sourcePath

  if (!assetName)
    return sourcePath

  return fileURLToPath(new URL(assetName, packageBaseUrl))
}
