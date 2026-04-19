import { sep } from 'node:path'

/** Опции сборки globs для UnoCSS `content.filesystem`. */
export interface BuildContentFsOptions {
  /** Абсолютные пути-директории, по которым строятся globs. */
  dirs: readonly string[]
  /**
   * Расширения файлов, по которым будут строиться globs.
   * По умолчанию: `['js', 'mjs', 'cjs', 'ts', 'vue']`.
   */
  extensions?: readonly string[]
  /**
   * Дополнительные пользовательские globs — просто добавляются в результат
   * после авто-сгенерированных (без дедупа — ответственность вызывающего).
   */
  extraGlobs?: readonly string[]
}

const DEFAULT_EXTENSIONS: readonly string[] = [
  'js',
  'mjs',
  'cjs',
  'ts',
  'mts',
  'cts',
  'jsx',
  'tsx',
  'vue',
]

/** Переводит путь к POSIX‑виду (важно для picomatch на Windows). */
function toPosix(path: string): string {
  if (sep === '/')
    return path
  return path.split(sep).join('/')
}

/** Убирает завершающий slash, если он есть. */
function stripTrailingSlash(path: string): string {
  return path.endsWith('/') ? path.slice(0, -1) : path
}

/**
 * Строит список glob-паттернов для UnoCSS `content.filesystem`.
 * Для каждой dir формируется `<dir>/**\/*.{ext1,ext2,...}`.
 */
export function buildFilesystemGlobs(opts: BuildContentFsOptions): string[] {
  const exts = (opts.extensions?.length ? opts.extensions : DEFAULT_EXTENSIONS)
    .map(e => e.replace(/^\./, ''))
    .filter(Boolean)

  if (exts.length === 0)
    return [...(opts.extraGlobs ?? [])]

  const extGroup = exts.length === 1 ? exts[0] : `{${exts.join(',')}}`

  const seen = new Set<string>()
  const result: string[] = []

  for (const dir of opts.dirs) {
    const normalized = stripTrailingSlash(toPosix(dir))
    const glob = `${normalized}/**/*.${extGroup}`
    if (seen.has(glob))
      continue
    seen.add(glob)
    result.push(glob)
  }

  for (const extra of opts.extraGlobs ?? []) {
    if (seen.has(extra))
      continue
    seen.add(extra)
    result.push(extra)
  }

  return result
}
