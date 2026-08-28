import type { GranularComponentDependency, GranularProvider } from './contract'
import type { ResolvedThemeWarning, ThemeNamesSource } from './core/resolveThemes'
import type { EmittedImportEdge } from './fs/emittedImports'
import type { ResolvedScanDir, SkippedScanDir } from './fs/resolveScanDirs'
import type { TokenUsageVia } from './fs/tokenUsage'
import type { PresetGranularResolution, resolvePresetGranular } from './preset'

import type { PresetGranularNodeOptions } from './preset.node'
import { buildRegistry } from './core/registry'
import { collectDependencyClosure } from './core/resolveSelection'
import { collectTokenLayers } from './core/tokenLayers'
import { inspectEmittedComponentImports } from './fs/emittedImports'
import { inspectGranularTokenUsage } from './fs/tokenUsage'
import { parseCssCustomPropertyBlocksSync } from './node-utils/tokenDefinitionsFromCss'
import { inspectGranularScanDirs, resolveGranularFilesystemGlobs, resolveGranularNode } from './preset.node'

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

export interface DoctorProviderInfo {
  id: string
  /** Кол-во объявленных компонентов у провайдера (не обязательно выбранных). */
  components: number
  hasTheme: boolean
  /** Провайдер отдаёт `unocss`-вклад (rules/variants/preflights). */
  hasUnocss: boolean
}

export interface DoctorComponentInfo {
  key: string
  providerId: string
  name: string
  dependencies: string[]
  safelist: number
  cssFiles: number
  group?: string
}

export interface DoctorThemeBlock {
  theme: string
  selector: string
  tokens: number
}

/** Токен, значение которого задают ≥2 источника (провайдер/компонент/override). */
export interface DoctorTokenConflict {
  theme: string
  selector: string
  token: string
  /** Источники в порядке применения: `provider:<id>`, `component:<name>`, `app-override`. */
  sources: string[]
  /** Итоговое (победившее) значение. */
  finalValue: string
}

/** Директория, реально уходящая в скан. Тот же тип, что у резолвера. */
export type DoctorScanDir = ResolvedScanDir

/**
 * Компонент, не попавший в скан. Это ТОТ ЖЕ тип, что отдаёт резолвер
 * `content.filesystem` — doctor не имеет собственного обхода FS и потому не
 * может разойтись с тем, что реально уходит в сборку.
 */
export type DoctorMissingDir = SkippedScanDir

/**
 * Импорт в чужую директорию, не покрытый графом `dependencies`.
 *
 * Тот же тип, что отдаёт FS-инспектор, — doctor не строит собственного обхода
 * `dist` и потому не может разойтись с тем, что реально отгружено.
 */
export type DoctorUndeclaredDependency = EmittedImportEdge

/**
 * Токен, который компонент потребляет через `var(--…)`, но которого не задаёт
 * ни один известный granular слой ни в одной активной теме.
 */
export interface DoctorUndefinedToken {
  /** Имя БЕЗ префикса `--`. */
  token: string
  /** Компонент-потребитель, `<providerId>:<Component>`. */
  component: string
  /** Каким каналом потребление стало видно. */
  via: TokenUsageVia[]
  /** Хотя бы одно потребление записано как `var(--x, …)` — тогда это не дефект. */
  hasFallback: boolean
}

/** Уровень диагностики. `error` роняет `doctor`, `warn` — только с `--strict`. */
export type DoctorDiagnosticLevel = 'error' | 'warn'

/**
 * Машиночитаемый вид проблемы:
 *   - `layout-contract` — компонент не попал в скан (единственный `error`);
 *   - `theme-warning` — предупреждение резолва тем (`ResolvedThemeWarning`);
 *   - `token-conflict` — токен задаётся несколькими слоями;
 *   - `unused-provider` — провайдер в сборке не даёт ей ничего;
 *   - `undeclared-dependency` — собранный компонент импортирует чужой,
 *     не объявив его в `dependencies`;
 *   - `token-prefix` — ключ токена объявлен С префиксом `--`: генератор
 *     дописывает префикс сам, в CSS уедет валидный, но бесполезный `----x`;
 *   - `token-undefined` — компонент потребляет токен, которого не задаёт ни
 *     один granular-слой.
 */
export type DoctorDiagnosticCode
  = | 'layout-contract'
    | 'theme-warning'
    | 'token-conflict'
    | 'unused-provider'
    | 'undeclared-dependency'
    | 'token-prefix'
    | 'token-undefined'

/**
 * Одна проблема с уровнем.
 *
 * Существует ради двух вещей: `--json` (внешние инструменты не должны парсить
 * текст) и `--strict` (в CI предупреждения обязаны падать). Детали каждой
 * проблемы лежат в соответствующем разделе отчёта — здесь только уровень,
 * код и сообщение.
 */
export interface DoctorDiagnostic {
  level: DoctorDiagnosticLevel
  code: DoctorDiagnosticCode
  /** К чему относится: `<providerId>:<Component>`, id провайдера, имя темы. */
  subject: string
  message: string
}

export interface DoctorReport {
  providers: DoctorProviderInfo[]
  components: DoctorComponentInfo[]
  themes: {
    names: readonly string[]
    /** Откуда взялись имена: явно из опций, из `defaultThemes` или фолбэк. */
    namesSource: ThemeNamesSource
    blocks: DoctorThemeBlock[]
    /** Не-фатальная диагностика набора тем (см. `ResolvedThemeWarning`). */
    warnings: readonly ResolvedThemeWarning[]
  }
  tokenConflicts: DoctorTokenConflict[]
  /** Токены, которые потребляются, но не задаются ни одним granular-слоем. */
  undefinedTokens: DoctorUndefinedToken[]
  /** Рёбра `dist`-импортов, которых нет в объявленном графе зависимостей. */
  undeclaredDependencies: DoctorUndeclaredDependency[]
  scan: {
    globs: string[]
    dirs: DoctorScanDir[]
    missing: DoctorMissingDir[]
  }
  /** Все найденные проблемы: сначала `error`, потом `warn`. */
  diagnostics: DoctorDiagnostic[]
  /** `true`, если нет диагностик уровня `error` (то есть проблем layout-контракта). */
  ok: boolean
  /** `true`, если нет вообще никаких диагностик. Это то, что проверяет `--strict`. */
  clean: boolean
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

function depToString(dep: GranularComponentDependency): string {
  if (typeof dep === 'string')
    return dep
  return `${dep.provider}:{${dep.components.join(', ')}}`
}

function computeTokenConflicts(
  resolution: ReturnType<typeof resolvePresetGranular>,
  themesOpts: PresetGranularNodeOptions['themes'],
): DoctorTokenConflict[] {
  const layers = collectTokenLayers(resolution.themes, themesOpts?.tokenOverrides, {
    strictTokens: themesOpts?.strictTokens,
  })

  const conflicts: DoctorTokenConflict[] = []
  for (const blocks of layers.values()) {
    for (const block of blocks) {
      for (const chain of block.tokens.values()) {
        // Конфликт — это когда значение перезаписывают ДВА И БОЛЕЕ слоя,
        // реально попавших в CSS. Отброшенный `strictTokens` override ничего
        // не перезаписывает: до этой правки doctor репортил его финальным
        // значением, которого в эмитируемом CSS не было.
        const emitted = chain.layers.filter(layer => layer.skipped === undefined)
        if (emitted.length < 2)
          continue
        conflicts.push({
          theme: chain.theme,
          selector: chain.selector,
          token: chain.token,
          sources: emitted.map(layer => layer.source),
          // При двух и более эмитированных слоях `effective` определён всегда.
          finalValue: chain.effective!,
        })
      }
    }
  }
  return conflicts
}

/** Токен, объявленный С префиксом `--`, и кто его объявил. */
interface DashPrefixedToken {
  theme: string
  token: string
  source: string
}

/**
 * Ключи токенов, записанные с префиксом `--`.
 *
 * Контракт (SPEC §6.1) требует ключи БЕЗ префикса: генератор дописывает его
 * сам, поэтому `'--brand'` превращается в валидный CSS custom property
 * `----brand` — тема ломается молча, без единой ошибки. Это самая
 * задокументированная ловушка контракта, и doctor обязан её показывать.
 *
 * Проверяются те же источники, что и в {@link computeTokenConflicts}:
 * вклады провайдеров/компонентов/приложения (`themes.items`) и оба вида
 * `tokenOverrides`.
 */
function computeDashPrefixedTokens(
  resolution: ReturnType<typeof resolvePresetGranular>,
  themesOpts: PresetGranularNodeOptions['themes'],
): DashPrefixedToken[] {
  const found: DashPrefixedToken[] = []
  const seen = new Set<string>()
  const add = (theme: string, token: string, source: string): void => {
    const key = `${theme}\0${token}\0${source}`
    if (seen.has(key))
      return
    seen.add(key)
    found.push({ theme, token, source })
  }

  for (const item of resolution.themes.items) {
    if (!item.tokenDefinition)
      continue
    const source = item.appDefined
      ? 'app-theme'
      : item.componentName ? `component:${item.componentName}` : `provider:${item.providerId}`
    for (const token of Object.keys(item.tokenDefinition.tokens)) {
      if (token.startsWith('--'))
        add(item.themeName, token, source)
    }
  }

  const overrides = themesOpts?.tokenOverrides
  if (overrides) {
    for (const [theme, value] of Object.entries(overrides)) {
      if (!value)
        continue
      for (const [key, inner] of Object.entries(value)) {
        if (typeof inner === 'string') {
          if (key.startsWith('--'))
            add(theme, key, 'app-override')
          continue
        }
        for (const token of Object.keys(inner)) {
          if (token.startsWith('--'))
            add(theme, token, 'app-override')
        }
      }
    }
  }

  return found
}

/**
 * Импорты в `dist`, не покрытые объявленным графом.
 *
 * Проверка сознательно НЕ смотрит на текущую селекцию: компонент-цель может
 * оказаться выбранным по другой причине, и тогда в этой конкретной сборке CSS
 * будет верным — но `dependencies` всё равно врут, и у следующего потребителя,
 * выбравшего компонент отдельно, классы исчезнут. Иначе самая частая
 * конфигурация (`components: 'all'`) не находила бы ничего никогда.
 *
 * От селекции не зависят ЦЕЛИ; ИСТОЧНИКАМИ остаются только выбранные
 * компоненты (`resolution.resolved.entries`) — читать `dist` пакета целиком
 * ради конфигурации приложения незачем. Поэтому автору провайдера доктора
 * надо запускать с `components: 'all'`, иначе он проверит лишь замыкание
 * своей селекции (это сказано в `docs/{en,ru}/authoring-providers.md`).
 */
function computeUndeclaredDependencies(
  resolution: PresetGranularResolution,
): DoctorUndeclaredDependency[] {
  const registry = buildRegistry(resolution.providers)
  const closures = new Map<string, Set<string>>()

  return inspectEmittedComponentImports(resolution).filter((edge) => {
    let closure = closures.get(edge.from)
    if (!closure) {
      closure = collectDependencyClosure(registry, edge.from)
      closures.set(edge.from, closure)
    }
    return !closure.has(edge.to)
  })
}

/** Причина, по которой компонент не попал в скан — общая для отчёта и диагностик. */
const REASON_TEXT: Record<DoctorMissingDir['reason'], string> = {
  'missing-dir': 'directory is missing',
  'missing-entry': 'index.js is missing',
  'invalid-base-url': 'invalid packageBaseUrl',
}

/** К чему относится предупреждение резолва тем. */
function themeWarningSubject(w: ResolvedThemeWarning): string {
  switch (w.kind) {
    case 'theme-extends-cycle':
      return w.chain.join(' → ')
    case 'multiple-default-themes':
      return w.themes.join(', ')
    case 'default-theme-without-source':
      return `${w.providerId}:${w.theme}`
    default:
      return w.theme
  }
}

/**
 * Токены, которые компоненты потребляют, но которых не задаёт ни один
 * granular-слой ни в одной активной теме.
 *
 * Из кандидатов вычитаются не только структурные токены (`tokenDefinitions`,
 * `tokenOverrides`), но и объявления из CSS, который пресет инлайнит сам:
 * `tokensCssUrl`, `baseCssUrl`, файлы тем. Иначе диагностика ругалась бы на
 * собственный CSS granular — то есть врала бы систематически.
 *
 * Оставшаяся открытость пространства ЕСТЬ и закрыта быть не может: токен
 * может прийти из `rules`/`shortcuts` самого UnoCSS или провайдера
 * (`provider.unocss`), из CSS приложения или из внешней библиотеки. Поэтому
 * находка — `warn`, а сообщение обязано называть эти источники.
 */
function computeUndefinedTokens(
  options: PresetGranularNodeOptions,
  resolution: ReturnType<typeof resolvePresetGranular>,
  scanDirs: readonly DoctorScanDir[],
): DoctorUndefinedToken[] {
  const defined = new Set<string>()

  const layers = collectTokenLayers(resolution.themes, options.themes?.tokenOverrides, {
    strictTokens: options.themes?.strictTokens,
  })
  for (const blocks of layers.values()) {
    for (const block of blocks) {
      for (const chain of block.tokens.values()) {
        if (chain.effective !== undefined)
          defined.add(chain.token)
      }
    }
  }

  // CSS, который пресет инлайнит целиком: его токены granular тоже «задаёт».
  const inlined: string[] = []
  for (const provider of resolution.providers) {
    const theme = provider.theme
    if (!theme)
      continue
    if (theme.tokensCssUrl)
      inlined.push(theme.tokensCssUrl)
    if (theme.baseCssUrl)
      inlined.push(theme.baseCssUrl)
    for (const name of resolution.themes.names) {
      const url = theme.themes?.[name]
      if (url)
        inlined.push(url)
    }
  }
  for (const key of ['baseFile', 'tokensFile'] as const) {
    const value = options.themes?.[key]
    if (typeof value === 'string')
      inlined.push(value)
    else if (value)
      inlined.push(...Object.values(value).filter((v): v is string => typeof v === 'string'))
  }
  for (const url of inlined) {
    try {
      for (const block of parseCssCustomPropertyBlocksSync(url)) {
        for (const token of Object.keys(block.tokens))
          defined.add(token)
      }
    }
    catch {
      // Нечитаемый или нестандартный CSS — не повод падать в диагностике;
      // о нечитаемом CSS сообщает сборка через `GranularCssReadError`.
    }
  }

  const usage = inspectGranularTokenUsage(options, resolution, scanDirs)
  const found: DoctorUndefinedToken[] = []
  for (const [token, byComponent] of usage.usage) {
    if (defined.has(token))
      continue
    for (const [component, entry] of byComponent) {
      found.push({ token, component, via: entry.via, hasFallback: entry.hasFallback })
    }
  }
  return found.sort((a, b) => a.component.localeCompare(b.component) || a.token.localeCompare(b.token))
}

/**
 * Сводит все находки отчёта в плоский список с уровнями.
 *
 * Уровни расставлены по одному критерию: **обязано ли это сломать сборку**.
 * Нарушение layout-контракта — обязано (классы компонента молча исчезают из
 * CSS), поэтому `error`. Всё остальное — законные, но подозрительные
 * конфигурации: конфликт токенов часто и есть замысел автора, частичная тема
 * может быть намеренной. Их уровень — `warn`, и падают они только под
 * `--strict`.
 *
 * `undeclared-dependency` по последствиям тянет на `error` — это ровно тот
 * механизм, которым классы исчезают из CSS. Уровень всё же `warn`, и причина
 * ровно одна: находка ЭВРИСТИЧЕСКАЯ. Она выведена из текста бандла
 * регулярным выражением, а не из контракта, поэтому ложное срабатывание
 * возможно (спецификатор внутри строкового литерала, bare-импорт у
 * провайдера, чей `id` не совпал с именем пакета). Ставить такую находку в
 * `ok: false` — значит дать эвристике право на безусловный отказ.
 *
 * Смягчением это НЕ является и мерой предосторожности для CI считаться не
 * может: `--strict`, который доки предлагают ставить в CI, роняет `warn`
 * ровно так же, как `error`. Разница только в поведении по умолчанию — и в
 * том, что находка меняет `clean`, а не `ok`.
 *
 * `token-undefined` — `warn` по той же причине и с той же асимметрией:
 * ложноположительное срабатывание возможно (токен задаётся вне granular —
 * правилами UnoCSS, `provider.unocss`, CSS приложения), ложноотрицательное
 * нет (если его задаёт granular, мы это видим). Пространство имён токенов
 * открыто по построению, и закрыть его отсевом по префиксу нельзя: префикс
 * задаётся `presetMini({ variablePrefix })` и пресету не известен, так что
 * угадывание внесло бы модель, которой нет.
 */
function collectDiagnostics(
  providers: readonly GranularProvider[],
  components: readonly DoctorComponentInfo[],
  missing: readonly DoctorMissingDir[],
  themeWarnings: readonly ResolvedThemeWarning[],
  tokenConflicts: readonly DoctorTokenConflict[],
  undeclared: readonly DoctorUndeclaredDependency[],
  dashTokens: readonly DashPrefixedToken[],
  undefinedTokens: readonly DoctorUndefinedToken[],
): DoctorDiagnostic[] {
  const errors: DoctorDiagnostic[] = missing.map(m => ({
    level: 'error' as const,
    code: 'layout-contract' as const,
    subject: `${m.providerId}:${m.componentName}`,
    message: `${REASON_TEXT[m.reason]} (${m.expectedDir})`,
  }))

  const warns: DoctorDiagnostic[] = []

  for (const w of themeWarnings) {
    warns.push({
      level: 'warn',
      code: 'theme-warning',
      subject: themeWarningSubject(w),
      message: formatThemeWarning(w),
    })
  }

  for (const t of tokenConflicts) {
    warns.push({
      level: 'warn',
      code: 'token-conflict',
      subject: `${t.theme}:${t.token}`,
      message: `${t.selector} { --${t.token} } is written by several layers `
        + `(${t.sources.join(' → ')}), final value: ${t.finalValue}`,
    })
  }

  for (const edge of undeclared) {
    warns.push({
      level: 'warn',
      code: 'undeclared-dependency',
      subject: edge.from,
      message: `the emitted code imports ${edge.to} ("${edge.specifier}" in ${edge.source}), `
        + `but ${edge.to} is not reachable from its dependencies — a selection without ${edge.to} `
        + 'never scans its directory and never merges its safelist',
    })
  }

  for (const t of dashTokens) {
    warns.push({
      level: 'warn',
      code: 'token-prefix',
      subject: `${t.theme}:${t.token}`,
      message: `token key is declared with the '--' prefix (${t.source}) — the generator adds the prefix `
        + `itself, so the CSS gets '--${t.token}' and the theme silently loses the value`,
    })
  }

  for (const t of undefinedTokens) {
    warns.push({
      level: 'warn',
      code: 'token-undefined',
      subject: `${t.component}:${t.token}`,
      message: `token '--${t.token}' is used by ${t.component} (${t.via.join(', ')}) but no granular layer `
        + 'defines it for any active theme — it may still come from rules/shortcuts of UnoCSS itself or of a '
        + 'provider (provider.unocss), from base/tokens/theme CSS, or from the application; granular does not '
        + `track those${t.hasFallback ? ' (the usage declares a fallback)' : ''}`,
    })
  }

  // Провайдер, который не дал сборке НИЧЕГО: ни одного выбранного компонента,
  // ни темы, ни unocss-вклада. Обычно это опечатка в `components` или
  // провайдер, оставшийся в конфиге после рефакторинга.
  const withSelected = new Set(components.map(c => c.providerId))
  for (const provider of providers) {
    if (withSelected.has(provider.id) || provider.theme || provider.unocss)
      continue
    warns.push({
      level: 'warn',
      code: 'unused-provider',
      subject: provider.id,
      message: 'the provider contributes nothing to the build: no selected components, no theme, no unocss',
    })
  }

  return [...errors, ...warns]
}

/**
 * Собирает диагностический отчёт по granular-конфигурации: резолвнутые
 * провайдеры, транзитивный граф выбранных компонентов, блоки токенов тем,
 * конфликты токенов между слоями, итоговые скан-globs и отсутствующие
 * `components/<Name>/` директории (нарушения layout-контракта).
 *
 * Чистая относительно опций (только читает FS для проверки директорий).
 */
export function granularDoctor(options: PresetGranularNodeOptions): DoctorReport {
  const resolution = resolveGranularNode(options)

  const providers: DoctorProviderInfo[] = resolution.providers.map(p => ({
    id: p.id,
    components: p.components.length,
    hasTheme: !!p.theme,
    hasUnocss: !!p.unocss,
  }))

  const components: DoctorComponentInfo[] = resolution.resolved.entries.map(({ provider, descriptor }) => ({
    key: `${provider.id}:${descriptor.name}`,
    providerId: provider.id,
    name: descriptor.name,
    dependencies: (descriptor.dependencies ?? []).map(depToString),
    safelist: descriptor.safelist?.length ?? 0,
    cssFiles: descriptor.cssFiles?.length ?? 0,
    ...(descriptor.group ? { group: descriptor.group } : {}),
  }))

  const blocks: DoctorThemeBlock[] = []
  for (const [theme, entry] of Object.entries(resolution.themes.tokenRegistry)) {
    for (const block of entry.blocks)
      blocks.push({ theme, selector: block.selector, tokens: Object.keys(block.tokens).length })
  }

  const tokenConflicts = computeTokenConflicts(resolution, options.themes)
  const globs = resolveGranularFilesystemGlobs(options)
  // Тот же (мемоизированный) результат, из которого построены globs выше.
  const { dirs, skipped } = inspectGranularScanDirs(options)

  const undeclaredDependencies = computeUndeclaredDependencies(resolution)
  const undefinedTokens = computeUndefinedTokens(options, resolution, dirs)

  const diagnostics = collectDiagnostics(
    resolution.providers,
    components,
    skipped,
    resolution.themes.warnings,
    tokenConflicts,
    undeclaredDependencies,
    computeDashPrefixedTokens(resolution, options.themes),
    undefinedTokens,
  )

  return {
    providers,
    components,
    themes: {
      names: resolution.themes.names,
      namesSource: resolution.themes.namesSource,
      blocks,
      warnings: resolution.themes.warnings,
    },
    tokenConflicts,
    undefinedTokens,
    undeclaredDependencies,
    scan: { globs, dirs, missing: skipped },
    diagnostics,
    ok: !diagnostics.some(d => d.level === 'error'),
    clean: diagnostics.length === 0,
  }
}

/** Счётчики диагностик по уровням — для форматтера и кода выхода CLI. */
export function countDoctorDiagnostics(
  report: DoctorReport,
): { errors: number, warnings: number } {
  let errors = 0
  let warnings = 0
  for (const d of report.diagnostics) {
    if (d.level === 'error')
      errors++
    else
      warnings++
  }
  return { errors, warnings }
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

const NAMES_SOURCE_TEXT: Record<ThemeNamesSource, string> = {
  'explicit': 'themes.names',
  'app-defined': 'keys of themes.define',
  'provider-defaults': 'providers\' defaultThemes',
  'fallback': 'core fallback',
}

const EXTENDS_REASON_TEXT: Record<'unknown' | 'opaque', string> = {
  unknown: 'no provider supplies a theme with that name',
  opaque: 'the theme comes as a ready-made CSS file, its values are opaque to the preset',
}

function formatThemeWarning(w: ResolvedThemeWarning): string {
  switch (w.kind) {
    case 'theme-extends-unresolved':
      return `theme "${w.theme}" extends "${w.base}", but there is nothing to inherit: `
        + `${EXTENDS_REASON_TEXT[w.reason]}`
    case 'theme-extends-cycle':
      return `cycle in themes.define[].extends: ${w.chain.join(' → ')} — the chain is cut`
    case 'default-theme-without-source':
      return `${w.providerId} lists "${w.theme}" in defaultThemes but does not supply it `
        + '(neither themes[name] nor tokenDefinitions[name])'
    case 'partial-theme':
      return `theme "${w.theme}" is not covered by every provider — missing from: ${w.providersWithout.join(', ')}`
    case 'multiple-default-themes':
      return `several themes are active by default: [${w.themes.join(', ')}] — `
        + 'their blocks are emitted simultaneously; with overlapping selectors the last one wins'
  }
}

/** Рендерит {@link DoctorReport} в человекочитаемый многострочный текст. */
export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = []
  const push = (s = ''): void => void lines.push(s)

  push('granular doctor')
  push('===============')
  push()

  push(`Providers (${report.providers.length}):`)
  for (const p of report.providers) {
    push(`  • ${p.id} — components: ${p.components}`
      + `${p.hasTheme ? ', theme: yes' : ''}${p.hasUnocss ? ', unocss: yes' : ''}`)
  }
  push()

  push(`Selected components (${report.components.length}, order = deps → dependents):`)
  for (const c of report.components) {
    const extra: string[] = []
    if (c.dependencies.length)
      extra.push(`deps: [${c.dependencies.join(', ')}]`)
    if (c.safelist)
      extra.push(`safelist: ${c.safelist}`)
    if (c.cssFiles)
      extra.push(`cssFiles: ${c.cssFiles}`)
    if (c.group)
      extra.push(`group: ${c.group}`)
    push(`  • ${c.key}${extra.length ? ` — ${extra.join(', ')}` : ''}`)
  }
  push()

  push(`Themes: [${report.themes.names.join(', ') || '—'}] (source: ${NAMES_SOURCE_TEXT[report.themes.namesSource]})`)
  for (const b of report.themes.blocks)
    push(`  • ${b.theme} → ${b.selector} (${b.tokens} token(s))`)
  for (const w of report.themes.warnings)
    push(`  ⚠ ${formatThemeWarning(w)}`)
  push()

  if (report.tokenConflicts.length) {
    push(`Token conflicts (${report.tokenConflicts.length}) — the value is written by several layers:`)
    for (const t of report.tokenConflicts)
      push(`  • [${t.theme}] ${t.selector} { --${t.token} } ← ${t.sources.join(' → ')} = ${t.finalValue}`)
    push()
  }

  if (report.undeclaredDependencies.length) {
    push(`Undeclared dependencies (${report.undeclaredDependencies.length}) — the import is in dist, not in dependencies:`)
    for (const edge of report.undeclaredDependencies)
      push(`  • ${edge.from} → ${edge.to} ("${edge.specifier}" in ${edge.source})`)
    push()
  }

  if (report.undefinedTokens.length) {
    push(`Undefined tokens (${report.undefinedTokens.length}) — used by a component, defined by no granular layer:`)
    for (const t of report.undefinedTokens) {
      push(`  • ${t.component} → --${t.token} (${t.via.join(', ')})`
        + `${t.hasFallback ? ' — has a fallback' : ''}`)
    }
    push('  They may still come from UnoCSS rules/shortcuts, provider.unocss, base/tokens/theme')
    push('  CSS or the application — granular does not track those.')
    push()
  }

  push(`Scan globs (${report.scan.globs.length}):`)
  for (const g of report.scan.globs)
    push(`  • ${g}`)
  push()

  if (report.scan.missing.length) {
    push(`⚠ Layout-contract problems (${report.scan.missing.length}):`)
    for (const m of report.scan.missing)
      push(`  • ${m.providerId}:${m.componentName} — ${REASON_TEXT[m.reason]} (${m.expectedDir})`)
    push()
  }

  const { errors, warnings } = countDoctorDiagnostics(report)

  if (report.diagnostics.length) {
    push(`Diagnostics summary (errors: ${errors}, warnings: ${warnings}):`)
    for (const d of report.diagnostics)
      push(`  ${d.level === 'error' ? '✗' : '⚠'} [${d.code}] ${d.subject} — ${d.message}`)
    push()
  }

  if (!report.ok)
    push(`✗ Layout-contract violations found: ${report.scan.missing.length}.`)
  else if (warnings)
    push(`✓ OK — no layout-contract violations; warnings: ${warnings} (they only fail with --strict).`)
  else
    push('✓ OK — no layout-contract violations.')

  return lines.join('\n')
}
