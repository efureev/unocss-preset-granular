import type { Preflight, Preset } from '@unocss/core'

import type { GranularProvider } from './contract'
import type { ResolvedThemeSelectorBlock } from './core/resolveThemes'
import type { ScanDirsInspection } from './fs/resolveScanDirs'
import type { PresetGranularOptions } from './preset'
import { resolveGranularLayer } from './core/layer'
import { buildFilesystemGlobs } from './fs/buildContentFilesystem'
import { readCss, resolveComponentCssFile, resolveCssFilePath } from './fs/readCss'
import { resolveComponentScanDirs } from './fs/resolveScanDirs'
import { materializeGranularOptions } from './node-utils/materializeRefs'
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
   * ДОПОЛНИТЕЛЬНЫЕ расширения файлов для glob'ов — добавляются к дефолтным
   * `['js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'jsx', 'tsx', 'vue']`.
   * Например, `extensions: ['mdx']` даст скан по дефолтным расширениям
   * ПЛЮС `.mdx`.
   */
  extensions?: readonly string[]
  /**
   * `true` — {@link extensions} задаёт полный список расширений вместо
   * дефолтного. Нужно, только если дефолтные расширения мешают; обычно
   * достаточно аддитивного `extensions`.
   */
  replaceExtensions?: boolean
  /** Дополнительные пользовательские globs (добавляются как есть). */
  extraGlobs?: readonly string[]
  /**
   * Разрешить сканировать исходники из `node_modules`. Default: `true`.
   * Если `false` — пути, в канонической форме лежащие внутри `node_modules`,
   * будут отброшены.
   */
  includeNodeModules?: boolean
  /**
   * Строгий режим контракта layout провайдера. Если `true` — отсутствие
   * `<packageBaseUrl>/components/<Name>/` или `index.js` в ней бросает
   * `GranularProviderContractError`. По умолчанию `false` — проблемные
   * компоненты логируются через `console.warn` и пропускаются.
   */
  strict?: boolean
}

export interface PresetGranularNodeOptions extends PresetGranularOptions {
  /** Авто-сканирование исходников провайдеров (для UnoCSS `content.filesystem`). */
  scan?: GranularScanOptions
  /**
   * Прогонять инлайн-CSS (base/tokens/темы/`cssFiles`), который node-слой
   * встраивает как preflight, через `transformer-directives` — раскрывая
   * `@apply`, `@screen` и `theme()`. По умолчанию `false` (preflight'ы UnoCSS
   * идут в обход трансформера, поэтому директивы в `cssFiles` не раскрываются).
   *
   * Требует, чтобы в окружении резолвились `@unocss/transformer-directives`
   * (реэкспортится из `unocss`) и `magic-string` — обе едут вместе с `unocss`.
   * Если их нет — CSS возвращается без изменений с одним `console.warn`.
   */
  expandDirectives?: boolean
}

/**
 * Резолюция для node-слоя: то же, что `resolvePresetGranular`, но поверх
 * опций с РАЗВЁРНУТЫМИ `tokenDefinitionsRef`.
 *
 * Все node-потребители обязаны ходить через неё: материализация возвращает
 * стабильный по ссылке объект, и только так резолюция, скан и `content`
 * попадают в одни и те же кэши. Прямой `resolvePresetGranular(options)` в
 * node-слое дал бы вторую резолюцию — с нераскрытыми ссылками.
 */
export function resolveGranularNode(
  options: PresetGranularNodeOptions,
): ReturnType<typeof resolvePresetGranular> {
  return resolvePresetGranular(materializeGranularOptions(options))
}

interface ResolvedFile {
  providerId: string
  componentName: string
  filePath: string
}

/** Откуда пришёл CSS-файл — для сообщения об ошибке чтения. */
interface CssSource {
  /** `provider:<id>` / `app-override` — кто объявил путь. */
  origin: string
  /** Секция: base/tokens, тема, компонент. */
  section: 'base/tokens' | 'theme' | 'component'
  /** Имя темы или компонента, если применимо. */
  subject?: string
}

/**
 * Ошибка чтения CSS с указанием ВИНОВНИКА.
 *
 * Без неё типовая ошибка публикации (провайдер не положил `styles.css` туда,
 * куда указывает контракт) выглядела как голый `ENOENT` с абсолютным путём:
 * ни провайдера, ни компонента, ни секции в сообщении не было.
 */
export class GranularCssReadError extends Error {
  constructor(
    public readonly file: string,
    public readonly source: CssSource,
    public readonly cause: unknown,
  ) {
    const what = source.subject ? `${source.section} '${source.subject}'` : source.section
    super(
      `Granular: failed to read CSS for ${what} declared by ${source.origin}.\n`
      + `  path: ${file}\n`
      + `  cause: ${(cause as Error)?.message ?? cause}`,
    )
    this.name = 'GranularCssReadError'
  }
}

/** `readCss` + контекст в ошибке. */
async function readCssFrom(file: string, source: CssSource): Promise<string> {
  try {
    return await readCss(file)
  }
  catch (error) {
    throw new GranularCssReadError(file, source, error)
  }
}

/**
 * Кэш резолва путей к CSS компонентов по идентичности РЕЗОЛЮЦИИ (а не опций):
 * резолюция сама мемоизирована по `options`, так что ключ эквивалентен, зато
 * функция остаётся вызываемой напрямую.
 *
 * Резолв делает `access` на каждый URL из `cssFiles` (проверка «есть ли
 * исходник, или брать fallback по `cssFileAssetNames`»), а вызывается из трёх
 * мест — `collectNodeCssSections`, `getGranularComponentCssFiles`,
 * `getGranularComponentCss` — и заново на КАЖДУЮ регенерацию UnoCSS при HMR.
 * `readCss` кэширован по mtime, а `access`-проверки не были.
 *
 * Кэшируется промис, а не результат: параллельные вызовы (а они и идут
 * параллельно — секции собираются через `Promise.all`) не должны множить
 * обход FS.
 *
 * Инвалидация: новый объект опций → новая резолюция → новая запись. Появление
 * или исчезновение файла на диске в пределах ОДНОЙ резолюции не подхватится —
 * пересборка провайдера в dev-режиме путей не меняет, а перезагрузка конфига
 * создаёт новый объект опций.
 */
const componentCssFilesCache = new WeakMap<
  ReturnType<typeof resolvePresetGranular>,
  Promise<ResolvedFile[]>
>()

function resolveComponentCssFiles(
  resolution: ReturnType<typeof resolvePresetGranular>,
): Promise<ResolvedFile[]> {
  const cached = componentCssFilesCache.get(resolution)
  if (cached)
    return cached

  const promise = computeComponentCssFiles(resolution)
  componentCssFilesCache.set(resolution, promise)
  return promise
}

async function computeComponentCssFiles(
  resolution: ReturnType<typeof resolvePresetGranular>,
): Promise<ResolvedFile[]> {
  const byKey = new Map<string, GranularProvider>()
  for (const provider of resolution.resolved.providers)
    byKey.set(provider.id, provider)

  const files = await Promise.all(
    resolution.cssFiles.map(async ({ providerId, componentName, url, assetName }) => {
      const provider = byKey.get(providerId)!
      const filePath = await resolveComponentCssFile(url, provider.packageBaseUrl, assetName)
      return { providerId, componentName, filePath }
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

/**
 * Собирает URL'ы base/tokens.css в порядке «все tokens → все base».
 *
 * Глобальный строковый override (`baseFile`/`tokensFile` — строка) эмитится
 * ОДИН раз и НЕ зависит от того, есть ли у провайдеров `theme` (иначе для
 * провайдера без темы глобальный base не подключался вовсе). Per-providerId
 * override и провайдерские значения по-прежнему берутся по провайдеру, но
 * дедуплицируются по итоговому URL.
 */
function resolveBaseTokenUrls(
  providers: readonly GranularProvider[],
  themes: PresetGranularNodeOptions['themes'],
): Array<{ url: string, origin: string }> {
  const urls: Array<{ url: string, origin: string }> = []
  const seen = new Set<string>()
  const add = (url: string | undefined, origin: string): void => {
    if (url && !seen.has(url)) {
      seen.add(url)
      urls.push({ url, origin })
    }
  }

  const tokensFile = themes?.tokensFile
  if (typeof tokensFile === 'string') {
    add(tokensFile, 'app-override (themes.tokensFile)')
  }
  else {
    for (const p of providers)
      add(pickThemeUrl(p.id, p.theme?.tokensCssUrl, tokensFile), `provider '${p.id}'`)
  }

  const baseFile = themes?.baseFile
  if (typeof baseFile === 'string') {
    add(baseFile, 'app-override (themes.baseFile)')
  }
  else {
    for (const p of providers)
      add(pickThemeUrl(p.id, p.theme?.baseCssUrl, baseFile), `provider '${p.id}'`)
  }

  return urls
}

type ThemeOverride = Readonly<Record<string, string | Readonly<Record<string, string>>>>

/**
 * Генерирует CSS-блоки токенов темы из её `blocks` (по одному на селектор) с
 * учётом `tokenOverrides`.
 *
 * Overrides:
 *   - плоское значение (строка) → пишется в ПЕРВИЧНЫЙ селектор темы;
 *   - объект → это `{ selector: { token: value } }`, пишется под указанный
 *     селектор (создаётся при необходимости).
 *
 * В `strict`-режиме override неизвестного токена (нет ни в одном блоке темы)
 * пропускается с `console.warn`.
 */
function generateThemeBlocks(
  themeName: string,
  blocks: readonly ResolvedThemeSelectorBlock[],
  overrides: ThemeOverride | undefined,
  strict: boolean,
): string[] {
  const order: string[] = []
  const bySelector = new Map<string, Record<string, string>>()
  const ensure = (selector: string): Record<string, string> => {
    let tokens = bySelector.get(selector)
    if (!tokens) {
      tokens = {}
      bySelector.set(selector, tokens)
      order.push(selector)
    }
    return tokens
  }

  // Один проход: и раскладываем токены по селекторам, и собираем множество
  // известных имён для `strictTokens` (раньше по `blocks` шли дважды подряд).
  const known = new Set<string>()
  for (const block of blocks) {
    Object.assign(ensure(block.selector), block.tokens)
    for (const key of Object.keys(block.tokens))
      known.add(key)
  }

  const warnUnknown = (token: string): void => {
    console.warn(`[granular] strictTokens: token "${token}" not found in providers for theme "${themeName}". Skipping.`)
  }

  if (overrides) {
    const primarySelector = blocks[0]?.selector ?? ':root'
    for (const [key, value] of Object.entries(overrides)) {
      if (typeof value === 'string') {
        if (strict && !known.has(key)) {
          warnUnknown(key)
          continue
        }
        ensure(primarySelector)[key] = value
        continue
      }

      const target = ensure(key)
      for (const [token, tokenValue] of Object.entries(value)) {
        if (strict && !known.has(token)) {
          warnUnknown(token)
          continue
        }
        target[token] = tokenValue
      }
    }
  }

  const result: string[] = []
  for (const selector of order) {
    const tokens = bySelector.get(selector)!
    const lines = Object.entries(tokens)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `  --${k}: ${v};`)
    if (lines.length === 0)
      continue
    result.push(`${selector || ':root'} {\n${lines.join('\n')}\n}`)
  }
  return result
}

/** Секции node-CSS, вычисленные один раз. См. {@link getGranularNodeCss}. */
interface NodeCssSections {
  /** tokens.css + base.css (провайдерские или app-override). */
  baseTokens: string[]
  /** Структурные блоки токенов тем (`tokenDefinitions` + `tokenOverrides`). */
  themeTokens: string[]
  /** Файлы тем (`themes[name]` c учётом `themeFiles`-override). */
  themeFiles: string[]
  /** CSS выбранных компонентов (`cssFiles`). */
  components: string[]
}

/**
 * Считывает и раскладывает весь node-CSS по секциям в заданном порядке:
 *   tokens → base → [theme token blocks] → [theme files] → component CSS
 * Секционное представление позволяет отдавать подмножества
 * ({@link getGranularThemeCss} / {@link getGranularComponentCss}) без повторного
 * склеивания «всего и сразу».
 */
async function collectNodeCssSections(
  options: PresetGranularNodeOptions,
): Promise<NodeCssSections> {
  const resolution = resolveGranularNode(options)

  // 1. Tokens & Base (с учётом app-override, глобальный — один раз).
  const baseTokenUrls = resolveBaseTokenUrls(resolution.providers, options.themes)
  const baseTokens = await Promise.all(
    baseTokenUrls.map(({ url, origin }) => readCssFrom(
      resolveCssFilePath(url),
      { origin, section: 'base/tokens' },
    )),
  )

  // 2. Theme token blocks (structural tokenDefinitions + tokenOverrides).
  const themeTokens: string[] = []
  for (const themeName of resolution.themes.names) {
    const entry = resolution.themes.tokenRegistry[themeName]
    const overrides = options.themes?.tokenOverrides?.[themeName]
    const strict = !!options.themes?.strictTokens

    if (!entry && !overrides)
      continue

    for (const block of generateThemeBlocks(themeName, entry?.blocks ?? [], overrides, strict))
      themeTokens.push(block)
  }

  // 3. Theme files (level-1 override).
  // Дедуп по ИТОГОВОМУ url: несколько провайдеров одного дизайн-системного
  // семейства могут ссылаться на один и тот же файл темы (или быть сведены к
  // нему через `themes.themeFiles`), и без дедупа он читается и инлайнится
  // столько раз, сколько провайдеров на него сослалось.
  const themeFileUrls: Array<{ url: string, providerId: string, themeName: string }> = []
  const seenThemeUrls = new Set<string>()
  for (const { providerId, themeName, cssUrl, tokenDefinition } of resolution.themes.items) {
    // Если есть tokenDefinition у ЭТОГО провайдера для ЭТОЙ темы — файл темы уже
    // не используется (токены эмитятся структурно). Иначе берём cssUrl + override.
    if (tokenDefinition)
      continue

    if (cssUrl) {
      const override = options.themes?.themeFiles?.[themeName]
      const finalUrl = pickThemeUrl(providerId, cssUrl, override as string | Partial<Record<string, string>> | undefined)
      if (finalUrl && !seenThemeUrls.has(finalUrl)) {
        seenThemeUrls.add(finalUrl)
        themeFileUrls.push({ url: finalUrl, providerId, themeName })
      }
    }
  }
  // Параллельно, как и соседние секции: список URL уже дедуплицирован выше,
  // порядок сохраняет `Promise.all`.
  const themeFiles = await Promise.all(
    themeFileUrls.map(({ url, providerId, themeName }) => readCssFrom(
      resolveCssFilePath(url),
      { origin: `provider '${providerId}'`, section: 'theme', subject: themeName },
    )),
  )

  // 4. Component CSS.
  const componentFiles = await resolveComponentCssFiles(resolution)
  const components = await Promise.all(
    componentFiles.map(f => readCssFrom(
      f.filePath,
      { origin: `provider '${f.providerId}'`, section: 'component', subject: f.componentName },
    )),
  )

  return { baseTokens, themeTokens, themeFiles, components }
}

/**
 * Собирает весь node-CSS для FS-preflight в порядке:
 *   tokens → base → [theme token blocks] → [theme files] → component CSS
 */
export async function getGranularNodeCss(
  options: PresetGranularNodeOptions,
): Promise<string> {
  const s = await collectNodeCssSections(options)
  return [...s.baseTokens, ...s.themeTokens, ...s.themeFiles, ...s.components]
    .filter(Boolean)
    .join('\n')
}

let directivesUnavailableWarned = false

/**
 * Прогоняет инлайн-CSS через `transformer-directives`, раскрывая `@apply` /
 * `@screen` / `theme()`. Трансформер и `magic-string` подгружаются лениво
 * (динамический импорт), чтобы не тянуть их, если `expandDirectives` выключен.
 *
 * Два отказа разведены намеренно:
 *
 *   1. НЕТ ЗАВИСИМОСТЕЙ — окружение без `unocss`/`magic-string`. Это состояние
 *      окружения, оно не меняется от вызова к вызову: warn один раз за процесс,
 *      CSS возвращается как есть.
 *   2. ОШИБКА В САМОМ CSS — например `@apply` неизвестного класса. Это ошибка
 *      пользователя в конкретном месте, и сообщать о ней надо КАЖДЫЙ раз и с
 *      исходным текстом ошибки. Раньше оба случая ловил один `catch`, выдавая
 *      «нужны разрешимые 'unocss' и 'magic-string'» — и, из-за флага, ровно
 *      один раз за процесс. Отладка `@apply` в таком режиме была невозможна.
 */
async function expandCssDirectives(
  css: string,
  generator: unknown,
): Promise<string> {
  if (!css || !generator)
    return css

  let transformer: { transform: (...args: never[]) => unknown }
  let magic: { toString: () => string }

  try {
    const [{ transformerDirectives }, { default: MagicString }] = await Promise.all([
      import('unocss'),
      import('magic-string'),
    ])
    transformer = transformerDirectives() as typeof transformer
    magic = new MagicString(css)
  }
  catch (error) {
    if (!directivesUnavailableWarned) {
      directivesUnavailableWarned = true
      console.warn(
        `[granular] expandDirectives: failed to load the transformer — `
        + `resolvable 'unocss' (transformerDirectives) and 'magic-string' are required. `
        + `CSS left unchanged. Cause: ${(error as Error)?.message ?? error}`,
      )
    }
    return css
  }

  try {
    // `transformer.transform(code, id, ctx)` читает только `ctx.uno`.
    await (transformer.transform as unknown as (
      code: unknown,
      id: string,
      ctx: unknown,
    ) => Promise<unknown>)(magic, 'granular-inline.css', { uno: generator })
    return magic.toString()
  }
  catch (error) {
    // НЕ глушим повторы: это ошибка в CSS, и она нужна пользователю каждый
    // раз, пока не исправлена.
    console.warn(
      `[granular] expandDirectives: failed to expand @apply/@screen/theme() `
      + `in the inline CSS. CSS left unchanged. Cause: ${(error as Error)?.message ?? error}`,
    )
    return css
  }
}

/** Возвращает один агрегирующий preflight, который лениво читает все CSS файлы. */
export function createGranularNodePreflight(
  options: PresetGranularNodeOptions,
  layer?: string,
): Preflight {
  return {
    layer,
    getCSS: async (ctx) => {
      const css = await getGranularNodeCss(options)
      if (!options.expandDirectives)
        return css
      return expandCssDirectives(css, ctx?.generator)
    },
  }
}

/**
 * Возвращает preflights, готовые к добавлению в UnoCSS preset — УЖЕ со слоем.
 *
 * Единственное место, где node-слой проставляет `layer` своим preflight'ам:
 * прогонять результат ещё раз через `applyLayerToAll` не нужно (и раньше
 * `presetGranularNode` делал именно это — безоперационно, но запутывая
 * вопрос «кто владеет слоем»).
 */
export function resolvePresetGranularNodePreflights(
  options: PresetGranularNodeOptions,
): Preflight[] {
  return [createGranularNodePreflight(options, resolveGranularLayer(options.layer))]
}

/** Возвращает список абсолютных путей/data-URL всех CSS файлов, которые будут в сборке. */
export async function getGranularComponentCssFiles(
  options: PresetGranularNodeOptions,
): Promise<string[]> {
  const resolution = resolveGranularNode(options)
  const files = await resolveComponentCssFiles(resolution)
  return files.map(f => f.filePath)
}

/** Читает и склеивает ТОЛЬКО component CSS (без base/tokens/themes). */
export async function getGranularComponentCss(
  options: PresetGranularNodeOptions,
): Promise<string> {
  const resolution = resolveGranularNode(options)
  const files = await resolveComponentCssFiles(resolution)
  // Тот же контекст ошибки, что и у основного пути (`collectNodeCssSections`):
  // голый ENOENT без провайдера и компонента здесь так же бесполезен.
  const parts = await Promise.all(files.map(f => readCssFrom(
    f.filePath,
    { origin: `provider '${f.providerId}'`, section: 'component', subject: f.componentName },
  )))
  return parts.join('\n')
}

/**
 * Читает и склеивает ТОЛЬКО «тематический» CSS: base + tokens + структурные
 * блоки токенов тем + файлы тем. Component-CSS сюда НЕ входит — его отдаёт
 * {@link getGranularComponentCss}. Вместе они дают тот же результат, что и
 * {@link getGranularNodeCss}.
 */
export async function getGranularThemeCss(
  options: PresetGranularNodeOptions,
): Promise<string> {
  const s = await collectNodeCssSections(options)
  return [...s.baseTokens, ...s.themeTokens, ...s.themeFiles]
    .filter(Boolean)
    .join('\n')
}

/**
 * Возвращает список glob-паттернов для UnoCSS `content.filesystem` — по одному
 * на каждую директорию исходников выбранных компонентов (и их транзитивных
 * `dependencies`). Не затрагивает компоненты провайдера, которые не выбраны.
 */
/**
 * Кэш инспекции скан-директорий по идентичности `options` — по образцу
 * `resolutionCache` в `preset.ts`.
 *
 * Один и тот же объект опций проходит через `presetGranularNode`,
 * `granularContent` (приложение обязано вызвать его в `uno.config`) и
 * `granularDoctor`. Без мемоизации каждый вызов делал бы `existsSync` +
 * `statSync` + `realpathSync` НА КАЖДЫЙ выбранный компонент (и столько же на
 * `groups/<group>/shared/`) — для `components: 'all'` это сотни синхронных
 * сисколов на загрузке конфига Vite, по 2–3 раза.
 *
 * Побочный эффект, на который стоит рассчитывать: `console.warn` о нарушениях
 * layout-контракта печатается ОДИН раз на объект опций, а не на каждый вызов.
 *
 * Инвалидация — та же, что у резолюции: перезагрузка конфига создаёт новый
 * объект опций, а с ним и новую запись в кэше.
 */
const scanInspectionCache = new WeakMap<PresetGranularNodeOptions, ScanDirsInspection>()

/**
 * Инспекция скан-директорий: что реально уйдёт в `content.filesystem`
 * (`dirs`) и какие компоненты отвалились по layout-контракту (`skipped`).
 *
 * ЕДИНАЯ точка обхода FS для всех потребителей: `granularContent`,
 * `resolveGranularFilesystemGlobs` и `granularDoctor`. Раньше doctor имел
 * собственную копию логики и показывал не тот набор директорий, который
 * попадал в сборку (в частности, включал компоненты без `index.js`).
 */
export function inspectGranularScanDirs(options: PresetGranularNodeOptions): ScanDirsInspection {
  const cached = scanInspectionCache.get(options)
  if (cached)
    return cached

  const scan = options.scan ?? {}
  let result: ScanDirsInspection = scan.enabled === false
    ? { dirs: [], skipped: [] }
    : resolveComponentScanDirs(resolveGranularNode(options), { strict: scan.strict === true })

  if (scan.includeNodeModules === false) {
    result = {
      dirs: result.dirs.filter(d => !d.dir.split(/[\\/]/).includes('node_modules')),
      skipped: result.skipped,
    }
  }

  scanInspectionCache.set(options, result)
  return result
}

/**
 * Абсолютные директории сканирования выбранных компонентов (и их транзитивных
 * `dependencies`). Возвращает `[]`, если авто-скан выключен (`scan.enabled:false`).
 */
function computeScanDirs(options: PresetGranularNodeOptions): string[] {
  return inspectGranularScanDirs(options).dirs.map(d => d.dir)
}

export function resolveGranularFilesystemGlobs(
  options: PresetGranularNodeOptions,
): string[] {
  const scan = options.scan ?? {}
  if (scan.enabled === false)
    return [...(scan.extraGlobs ?? [])]

  return buildFilesystemGlobs({
    dirs: computeScanDirs(options),
    extensions: scan.extensions,
    replaceExtensions: scan.replaceExtensions,
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
/**
 * Кэш готового `content` по идентичности `options`.
 *
 * `granularContent` вызывает приложение в `uno.config`, а следом — сам
 * `presetGranularNode`. Обход FS уже мемоизирован, но глобы и `new RegExp` на
 * каждую компонентную директорию собирались заново на каждый вызов.
 *
 * Возвращается ОДИН и тот же объект: UnoCSS его только читает.
 */
const contentCache = new WeakMap<
  PresetGranularNodeOptions,
  { filesystem: string[], pipeline: { include: RegExp[] } }
>()

export function granularContent(
  options: PresetGranularNodeOptions,
): { filesystem: string[], pipeline: { include: RegExp[] } } {
  const cached = contentCache.get(options)
  if (cached)
    return cached

  const scan = options.scan ?? {}

  // Один расчёт директорий скана — из него строятся и filesystem-globs,
  // и таргетированные pipeline.include-regex (раньше считалось дважды).
  const dirs = computeScanDirs(options)

  const filesystem = scan.enabled === false
    ? [...(scan.extraGlobs ?? [])]
    : buildFilesystemGlobs({
        dirs,
        extensions: scan.extensions,
        replaceExtensions: scan.replaceExtensions,
        extraGlobs: scan.extraGlobs,
      })

  const content = {
    filesystem,
    pipeline: {
      include: [
        DEFAULT_PIPELINE_INCLUDE_USER,
        ...buildComponentPipelineIncludes(dirs),
      ],
    },
  }

  contentCache.set(options, content)
  return content
}

/**
 * Node-вариант пресета: оборачивает `presetGranular` и докидывает FS-preflights
 * для base/tokens/тем/компонентов.
 *
 * Замечание про UnoCSS‑vite: filesystem/pipeline он НЕ читает из пресета —
 * используйте хелпер {@link granularContent} в своём `defineConfig`.
 */
export function presetGranularNode(options: PresetGranularNodeOptions): Preset {
  // Материализованные опции и здесь: иначе браузерный пресет посчитал бы
  // ВТОРУЮ резолюцию — по исходному объекту.
  const base = presetGranular(materializeGranularOptions(options))
  // Слой уже проставлен внутри (см. `resolvePresetGranularNodePreflights`),
  // второй проход был бы безоперационным.
  const nodePreflights = resolvePresetGranularNodePreflights(options)

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
    // `content` отдаём ВСЕГДА, даже когда globs пустые (`scan.enabled: false`
    // без `extraGlobs`, либо все компоненты отсеяны по layout-контракту):
    // `pipeline.include` от числа globs не зависит и терять его нельзя —
    // без него extractor не заглянет в `.js` внутри компонентных директорий.
    content: {
      filesystem: [...(base.content?.filesystem ?? []), ...fsContent.filesystem],
      pipeline: fsContent.pipeline,
    },
  }
}

/** Единый билдер granular-конфигурации для node-слоя. См. {@link defineGranular}. */
export interface GranularBuilder {
  /** Исходные опции (та же ссылка — на ней завязана мемоизация резолюции). */
  readonly options: PresetGranularNodeOptions
  /** `Preset` для `defineConfig({ presets: [...] })`. */
  preset: () => Preset
  /** `content` для `defineConfig({ content })`. */
  content: () => { filesystem: string[], pipeline: { include: RegExp[] } }
  /** Ленивая резолюция (мемоизирована по `options`). */
  resolution: () => ReturnType<typeof resolvePresetGranular>
  /** Полный node-CSS (для отладки/генераторов). */
  nodeCss: () => Promise<string>
}

/**
 * Единая точка входа для приложения: считает резолюцию один раз (мемоизация по
 * `options`) и отдаёт согласованные `preset()` и `content()`. Избавляет от
 * ручной синхронизации `presetGranularNode(options)` и `granularContent(options)`
 * — обе половины гарантированно видят одни и те же опции.
 *
 * ```ts
 * const g = defineGranular({ providers: [...], components: [...] })
 * export default defineConfig({
 *   presets: [presetMini(), g.preset()],
 *   content: g.content(),
 * })
 * ```
 */
export function defineGranular(options: PresetGranularNodeOptions): GranularBuilder {
  return {
    options,
    preset: () => presetGranularNode(options),
    content: () => granularContent(options),
    resolution: () => resolveGranularNode(options),
    nodeCss: () => getGranularNodeCss(options),
  }
}
