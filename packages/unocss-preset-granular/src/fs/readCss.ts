import { Buffer } from 'node:buffer'
import { access, readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
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
    return resolve(process.cwd(), url.pathname.replace(/^\/+/, ''))
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

/** Читает CSS либо из data URL, либо из локального файла. */
export async function readCss(file: string): Promise<string> {
  if (isCssDataUrl(file))
    return decodeCssDataUrl(file)
  return readFile(file, 'utf8')
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
