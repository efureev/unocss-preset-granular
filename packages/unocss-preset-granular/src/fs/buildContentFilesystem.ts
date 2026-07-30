import { sep } from 'node:path'

/** Опции сборки globs для UnoCSS `content.filesystem`. */
export interface BuildContentFsOptions {
  /** Абсолютные пути-директории, по которым строятся globs. */
  dirs: readonly string[]
  /**
   * ДОПОЛНИТЕЛЬНЫЕ расширения файлов, по которым строятся globs — они
   * добавляются к {@link DEFAULT_EXTENSIONS} (`js`, `mjs`, `cjs`, `ts`, `mts`,
   * `cts`, `jsx`, `tsx`, `vue`), а не заменяют их. Точка в начале
   * необязательна: `'mdx'` и `'.mdx'` эквивалентны.
   *
   * Чтобы задать список целиком — см. {@link replaceExtensions}.
   */
  extensions?: readonly string[]
  /**
   * `true` — трактовать {@link extensions} как ПОЛНЫЙ список расширений,
   * а не как дополнение к дефолтному. Пустой/незаданный `extensions` при
   * этом означает «глобов по расширениям не строить вовсе» — останутся
   * только {@link extraGlobs}.
   */
  replaceExtensions?: boolean
  /**
   * Дополнительные пользовательские globs — просто добавляются в результат
   * после авто-сгенерированных (без дедупа — ответственность вызывающего).
   */
  extraGlobs?: readonly string[]
}

export const DEFAULT_EXTENSIONS: readonly string[] = [
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
 *
 * Для каждой `dir` формируется рекурсивный glob
 * `<dir>/**\/*.{ext1,ext2,...}` — extractor пройдёт по всем подпапкам
 * `dist/components/<Name>/` (включая `chunks/`), что и обеспечивает
 * сбор утилитарных классов из скомпилированных SFC‑чанков провайдера.
 */
/**
 * Итоговый список расширений скана — без точки, дедуплицированный.
 *
 * Вынесен отдельно, потому что по нему ходит не только сборщик globs:
 * `granular why-css` перебирает те же файлы напрямую и обязан видеть ровно
 * тот набор расширений, который уйдёт в `content.filesystem`.
 */
export function resolveScanExtensions(
  opts: Pick<BuildContentFsOptions, 'extensions' | 'replaceExtensions'>,
): string[] {
  const requested = (opts.extensions ?? []).map(e => e.replace(/^\./, '')).filter(Boolean)
  // По умолчанию `extensions` ДОПОЛНЯЕТ дефолтный список: пользователь,
  // написавший `extensions: ['mdx']`, ожидает «mdx в дополнение к vue/ts»,
  // а не «только mdx» (последнее полностью выключает скан компонентов).
  return opts.replaceExtensions
    ? requested
    : [...new Set([...DEFAULT_EXTENSIONS, ...requested])]
}

export function buildFilesystemGlobs(opts: BuildContentFsOptions): string[] {
  const exts = resolveScanExtensions(opts)

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
