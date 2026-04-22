import type { Preflight, Preset } from '@unocss/core'

import type { GranularProvider } from './contract'
import type { PresetGranularOptions } from './preset'
import { applyLayerToAll } from './core/layer'
import { buildFilesystemGlobs } from './fs/buildContentFilesystem'
import { readCss, resolveComponentCssFile, resolveCssFilePath } from './fs/readCss'
import { resolveComponentScanDirs } from './fs/resolveScanDirs'
import {
  presetGranular,

  resolvePresetGranular,
} from './preset'

/**
 * Опции автоматического сканирования исходников компонентов для
 * UnoCSS `content.filesystem`. См. {@link PresetGranularNodeOptions}.
 */
export interface GranularScanOptions {
  /** Полностью отключить авто-filesystem. По умолчанию `true`. */
  enabled?: boolean
  /**
   * Расширения файлов для glob'ов. По умолчанию —
   * `['js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'jsx', 'tsx', 'vue']`.
   */
  extensions?: readonly string[]
  /** Дополнительные пользовательские globs (добавляются как есть). */
  extraGlobs?: readonly string[]
  /**
   * Разрешить сканировать исходники из `node_modules`. Default: `true`.
   * Если `false` — пути, в канонической форме лежащие внутри `node_modules`,
   * будут отброшены.
   */
  includeNodeModules?: boolean
}

export interface PresetGranularNodeOptions extends PresetGranularOptions {
  /** Авто-сканирование исходников провайдеров (для UnoCSS `content.filesystem`). */
  scan?: GranularScanOptions
}

interface ResolvedFile {
  providerId: string
  filePath: string
}

async function resolveComponentCssFiles(
  resolution: ReturnType<typeof resolvePresetGranular>,
): Promise<ResolvedFile[]> {
  const byKey = new Map<string, GranularProvider>()
  for (const provider of resolution.resolved.providers)
    byKey.set(provider.id, provider)

  const files = await Promise.all(
    resolution.cssFiles.map(async ({ providerId, url, assetName }) => {
      const provider = byKey.get(providerId)!
      const filePath = await resolveComponentCssFile(url, provider.packageBaseUrl, assetName)
      return { providerId, filePath }
    }),
  )
  // Дедуп по итоговому пути (после fallback src/↔dist/)
  const seen = new Set<string>()
  return files.filter(f => !seen.has(f.filePath) && seen.add(f.filePath))
}

/** Resolve base/tokens/theme URL с учётом override'а из ThemesOptions. */
function pickThemeUrl(
  providerId: string,
  providerUrl: string | undefined,
  override: string | Partial<Record<string, string>> | undefined,
): string | undefined {
  if (typeof override === 'string')
    return override
  if (override && typeof override === 'object') {
    const byProvider = override[providerId]
    if (byProvider !== undefined)
      return byProvider
  }
  return providerUrl
}

/** Генерирует CSS-блок токенов из реестра и overrides. */
function generateTokenBlock(
  themeName: string,
  selector: string | undefined,
  tokens: Record<string, string>,
  overrides: Record<string, string> | undefined,
  strict: boolean,
): string {
  const finalTokens = { ...tokens }

  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (strict && tokens[key] === undefined) {
        console.warn(`[granular] strictTokens: token "${key}" not found in providers for theme "${themeName}". Skipping.`)
        continue
      }
      finalTokens[key] = value
    }
  }

  const lines = Object.entries(finalTokens)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `  --${k}: ${v};`)

  if (lines.length === 0)
    return ''

  return `${selector || ':root'} {\n${lines.join('\n')}\n}`
}

/**
 * Собирает FS-preflights для выбранных провайдеров в заданном порядке:
 *   tokens → base → [theme overrides] → [theme files] → component CSS
 * Возвращает один агрегирующий Preflight с асинхронным `getCSS`.
 */
export async function getGranularNodeCss(
  options: PresetGranularNodeOptions,
): Promise<string> {
  const resolution = resolvePresetGranular(options)
  const chunks: string[] = []

  // 1. Tokens & Base
  for (const provider of resolution.providers) {
    const theme = provider.theme
    if (!theme)
      continue

    const tokensUrl = pickThemeUrl(provider.id, theme.tokensCssUrl, options.themes?.tokensFile)
    if (tokensUrl)
      chunks.push(await readCss(resolveCssFilePath(tokensUrl)))

    const baseUrl = pickThemeUrl(provider.id, theme.baseCssUrl, options.themes?.baseFile)
    if (baseUrl)
      chunks.push(await readCss(resolveCssFilePath(baseUrl)))
  }

  // 2. Theme Token Overrides (Structural)
  for (const themeName of resolution.themes.names) {
    const registry = resolution.themes.tokenRegistry[themeName]
    const overrides = options.themes?.tokenOverrides?.[themeName]
    const strict = !!options.themes?.strictTokens

    if (registry || overrides) {
      const block = generateTokenBlock(
        themeName,
        registry?.selector,
        registry?.tokens || {},
        overrides,
        strict,
      )
      if (block)
        chunks.push(block)
    }
  }

  // 3. Theme Files (Level 1 Override)
  for (const { providerId, themeName, cssUrl, tokenDefinition } of resolution.themes.items) {
    // Если есть tokenDefinition у ЭТОГО провайдера для ЭТОЙ темы, файл themes[name] уже пропущен резолвером.
    // Если tokenDefinition нет, берем cssUrl и проверяем override themeFiles.
    if (tokenDefinition)
      continue

    if (cssUrl) {
      const override = options.themes?.themeFiles?.[themeName]
      const finalUrl = pickThemeUrl(providerId, cssUrl, override as any)

      if (finalUrl)
        chunks.push(await readCss(resolveCssFilePath(finalUrl)))
    }
  }

  // 4. Component CSS
  const componentFiles = await resolveComponentCssFiles(resolution)
  for (const { filePath } of componentFiles)
    chunks.push(await readCss(filePath))

  return chunks.filter(Boolean).join('\n')
}

/** Возвращает один агрегирующий preflight, который лениво читает все CSS файлы. */
export function createGranularNodePreflight(
  options: PresetGranularNodeOptions,
  layer?: string,
): Preflight {
  return {
    layer,
    getCSS: () => getGranularNodeCss(options),
  }
}

/** Возвращает массив preflights, готовых к добавлению в UnoCSS preset. */
export function resolvePresetGranularNodePreflights(
  options: PresetGranularNodeOptions,
): Preflight[] {
  return [createGranularNodePreflight(options, options.layer)]
}

/** Возвращает список абсолютных путей/data-URL всех CSS файлов, которые будут в сборке. */
export async function getGranularComponentCssFiles(
  options: PresetGranularNodeOptions,
): Promise<string[]> {
  const resolution = resolvePresetGranular(options)
  const files = await resolveComponentCssFiles(resolution)
  return files.map(f => f.filePath)
}

/** Читает и склеивает ТОЛЬКО component CSS (без base/tokens/themes). */
export async function getGranularComponentCss(
  options: PresetGranularNodeOptions,
): Promise<string> {
  const resolution = resolvePresetGranular(options)
  const files = await resolveComponentCssFiles(resolution)
  const parts = await Promise.all(files.map(f => readCss(f.filePath)))
  return parts.join('\n')
}

/** Читает и склеивает ТОЛЬКО темы (пересечение с `themes.names`). */
export async function getGranularThemeCss(
  options: PresetGranularNodeOptions,
): Promise<string> {
  const css = await getGranularNodeCss(options)
  // TODO: Если нужно разделить, придется фильтровать или переписывать.
  // Но обычно getGranularThemeCss используется для отладки.
  return css
}

/**
 * Возвращает список glob-паттернов для UnoCSS `content.filesystem` — по одному
 * на каждую директорию исходников выбранных компонентов (и их транзитивных
 * `dependencies`). Не затрагивает компоненты провайдера, которые не выбраны.
 */
export function resolveGranularFilesystemGlobs(
  options: PresetGranularNodeOptions,
): string[] {
  const scan = options.scan ?? {}
  if (scan.enabled === false)
    return [...(scan.extraGlobs ?? [])]

  const resolution = resolvePresetGranular(options)
  let dirs = resolveComponentScanDirs(resolution).map(d => d.dir)

  if (scan.includeNodeModules === false)
    dirs = dirs.filter(d => !d.split(/[\\/]/).includes('node_modules'))

  return buildFilesystemGlobs({
    dirs,
    extensions: scan.extensions,
    extraGlobs: scan.extraGlobs,
  })
}

/**
 * Стандартный UnoCSS‑фильтр «исходных» расширений, по которым extractor
 * работает для пользовательского кода приложения. Обратите внимание —
 * сюда намеренно НЕ включены `.js/.mjs/.cjs/.ts/.mts/.cts`, чтобы
 * extractor не сканировал произвольный JS (в т.ч. минифицированные
 * чанки Vue/других зависимостей), вылавливая в нём случайные подстроки
 * вроде `ms`, `mt`, `block`, которые `presetMini` может посчитать
 * валидными утилитами.
 */
const DEFAULT_PIPELINE_INCLUDE_USER: RegExp = /\.(vue|svelte|[jt]sx|mdx?|astro|elm|php|phtml|html)($|\?)/

/**
 * Расширения, которые мы допускаем для сканирования ВНУТРИ директорий
 * выбранных компонентов (и их транзитивных `dependencies`). Сюда мы
 * добавляем `.js/.mjs/.cjs/.ts/.mts/.cts`, чтобы extractor видел
 * классы в скомпилированных SFC‑чанках из `dist/` провайдеров.
 */
const COMPONENT_PIPELINE_EXT_RE: string = '\\.(vue|svelte|[jt]sx|mdx?|astro|elm|php|phtml|html|js|mjs|cjs|ts|mts|cts)($|\\?)'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Собирает массив regex‑ов для `pipeline.include`, ограниченный
 * абсолютными путями директорий выбранных компонентов. Таким образом
 * extractor лезет в `.js`/`.ts` ТОЛЬКО внутри компонентных директорий
 * (например `packages/simple-package/dist/components/XTokenized/`),
 * а бандл‑чанки vue/node_modules, попавшие в сборку, им не затрагиваются.
 */
function buildComponentPipelineIncludes(dirs: readonly string[]): RegExp[] {
  return dirs.map((dir) => {
    // Нормализуем trailing‑слэш, чтобы граница директории была однозначной.
    const normalized = dir.replace(/[\\/]+$/, '')
    const escaped = escapeRegExp(normalized)
    return new RegExp(`^${escaped}[\\\\/].*${COMPONENT_PIPELINE_EXT_RE}`)
  })
}

/**
 * Возвращает готовый объект `content` для `defineConfig({ content })` UnoCSS:
 *
 *   - `filesystem` — globs по выбранным компонентам и их транзитивным
 *     `dependencies` (ничего лишнего не подключается);
 *   - `pipeline.include` — стандартный фильтр (`.vue/.ts/.tsx/.html/...`) ПЛЮС
 *     таргетированные regex по **абсолютным путям** директорий выбранных
 *     компонентов, внутри которых дополнительно разрешены `.js/.mjs/.cjs/.ts/...`
 *     Это позволяет extractor'у подхватывать утилитарные классы в
 *     скомпилированных SFC‑чанках провайдера, **не трогая** произвольный
 *     JS из `node_modules` / собственного бандла приложения.
 *
 * ВАЖНО: `@unocss/vite` читает `content.filesystem`/`content.pipeline.include`
 * ТОЛЬКО из ТОП‑уровня user‑config'а (а не из `preset.content`), поэтому
 * приложению нужно явно развернуть результат этой функции в свой `uno.config`:
 *
 * ```ts
 * defineConfig({
 *   presets: [presetGranularNode(opts)],
 *   content: granularContent(opts),
 * })
 * ```
 */
export function granularContent(
  options: PresetGranularNodeOptions,
): { filesystem: string[], pipeline: { include: RegExp[] } } {
  const filesystem = resolveGranularFilesystemGlobs(options)

  const scan = options.scan ?? {}
  let dirs: string[] = []
  if (scan.enabled !== false) {
    const resolution = resolvePresetGranular(options)
    dirs = resolveComponentScanDirs(resolution).map(d => d.dir)
    if (scan.includeNodeModules === false)
      dirs = dirs.filter(d => !d.split(/[\\/]/).includes('node_modules'))
  }

  return {
    filesystem,
    pipeline: {
      include: [
        DEFAULT_PIPELINE_INCLUDE_USER,
        ...buildComponentPipelineIncludes(dirs),
      ],
    },
  }
}

/**
 * Node-вариант пресета: оборачивает `presetGranular` и докидывает FS-preflights
 * для base/tokens/тем/компонентов.
 *
 * Замечание про UnoCSS‑vite: filesystem/pipeline он НЕ читает из пресета —
 * используйте хелпер {@link granularContent} в своём `defineConfig`.
 */
export function presetGranularNode(options: PresetGranularNodeOptions): Preset {
  const base = presetGranular(options)
  const nodePreflights = applyLayerToAll(
    resolvePresetGranularNodePreflights(options),
    options.layer,
  )

  // Всё же проставляем `content` и в самом пресете — для тех инструментов,
  // которые уважают resolved‑config (cli, автономные генераторы, будущие
  // версии vite‑плагина).
  const fsContent = granularContent(options)

  return {
    ...base,
    preflights: [
      ...nodePreflights,
      ...(base.preflights ?? []),
    ],
    content: fsContent.filesystem.length > 0
      ? {
          filesystem: [...(base.content?.filesystem ?? []), ...fsContent.filesystem],
          pipeline: fsContent.pipeline ?? base.content?.pipeline,
        }
      : base.content,
  }
}
