import type { GranularComponentDependency, GranularProvider } from './contract'
import type { ResolvedThemeWarning, ThemeNamesSource } from './core/resolveThemes'
import type { EmittedImportEdge } from './fs/emittedImports'
import type { DoctorI18nSubpath } from './fs/i18nSubpaths'
import type { ResolvedScanDir, SkippedScanDir } from './fs/resolveScanDirs'
import type { PresetGranularResolution, resolvePresetGranular } from './preset'

import type { PresetGranularNodeOptions } from './preset.node'
import { buildRegistry } from './core/registry'
import { collectDependencyClosure } from './core/resolveSelection'
import { inspectEmittedComponentImports } from './fs/emittedImports'
import { inspectI18nSubpaths } from './fs/i18nSubpaths'
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
  /**
   * Локали блока строк, если пакет его объявил.
   *
   * Имён блоков здесь нет и быть не может: контракт их не несёт — имя лежит
   * внутри коллекции лоадеров, а импортировать её doctor не станет. Поэтому
   * столкновение блоков двух пакетов отсюда не видно; в `fint-i18n` оно и не
   * ошибка, а штатный мердж.
   */
  i18nLocales?: string[]
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
 *     дописывает префикс сам, в CSS уедет валидный, но бесполезный `----x`.
 *   - `i18n-subpath` — подпуть строк объявлен, но пакет его не экспортирует:
 *     упадёт ЧУЖАЯ сборка, и искать причину будут в приложении.
 */
export type DoctorDiagnosticCode
  = | 'layout-contract'
    | 'theme-warning'
    | 'token-conflict'
    | 'unused-provider'
    | 'undeclared-dependency'
    | 'token-prefix'
    | 'i18n-subpath'

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
  const registry = resolution.themes.tokenRegistry
  const primaryOf = (theme: string): string => registry[theme]?.blocks[0]?.selector ?? ':root'

  const map = new Map<string, { theme: string, selector: string, token: string, sources: string[], value: string }>()
  const add = (theme: string, selector: string, token: string, value: string, source: string): void => {
    // NUL как разделитель: он не встречается ни в имени темы, ни в селекторе,
    // ни в имени токена, поэтому склейка ключа однозначна. Пишется escape'ом
    // `\0`, а не сырым байтом — иначе git считает файл бинарным.
    const key = `${theme}\0${selector}\0${token}`
    let entry = map.get(key)
    if (!entry) {
      entry = { theme, selector, token, sources: [], value }
      map.set(key, entry)
    }
    entry.sources.push(source)
    entry.value = value
  }

  // Провайдерские и компонентные вклады.
  for (const item of resolution.themes.items) {
    if (!item.tokenDefinition)
      continue
    const selector = item.tokenDefinition.selector ?? primaryOf(item.themeName)
    const source = item.appDefined
      ? 'app-theme'
      : item.componentName ? `component:${item.componentName}` : `provider:${item.providerId}`
    for (const [token, value] of Object.entries(item.tokenDefinition.tokens))
      add(item.themeName, selector, token, value, source)
  }

  // App-overrides (плоская и вложенная формы).
  const overrides = themesOpts?.tokenOverrides
  if (overrides) {
    for (const [theme, value] of Object.entries(overrides)) {
      if (!value)
        continue
      for (const [key, inner] of Object.entries(value)) {
        if (typeof inner === 'string') {
          add(theme, primaryOf(theme), key, inner, 'app-override')
        }
        else {
          for (const [token, tokenValue] of Object.entries(inner))
            add(theme, key, token, tokenValue, 'app-override')
        }
      }
    }
  }

  return [...map.values()]
    .filter(e => e.sources.length > 1)
    .map(e => ({ theme: e.theme, selector: e.selector, token: e.token, sources: e.sources, finalValue: e.value }))
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
 */
function collectDiagnostics(
  providers: readonly GranularProvider[],
  components: readonly DoctorComponentInfo[],
  missing: readonly DoctorMissingDir[],
  themeWarnings: readonly ResolvedThemeWarning[],
  tokenConflicts: readonly DoctorTokenConflict[],
  undeclared: readonly DoctorUndeclaredDependency[],
  dashTokens: readonly DashPrefixedToken[],
  i18nSubpaths: readonly DoctorI18nSubpath[],
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

  for (const subpath of i18nSubpaths) {
    warns.push({
      level: 'warn',
      code: 'i18n-subpath',
      subject: `${subpath.providerId}:${subpath.field}`,
      message: `'i18n.${subpath.field}' points at ${subpath.specifier}, but '${subpath.subpath}' is not `
        + `in the package's exports (${subpath.packageJson}) — the consumer's build will fail to `
        + 'resolve it, and the error will name their application, not this package',
    })
  }

  // Провайдер, который не дал сборке НИЧЕГО: ни одного выбранного компонента,
  // ни темы, ни unocss-вклада, ни строк. Обычно это опечатка в `components`
  // или провайдер, оставшийся в конфиге после рефакторинга.
  const withSelected = new Set(components.map(c => c.providerId))
  for (const provider of providers) {
    if (withSelected.has(provider.id) || provider.theme || provider.unocss || provider.i18n)
      continue
    warns.push({
      level: 'warn',
      code: 'unused-provider',
      subject: provider.id,
      message: 'the provider contributes nothing to the build: no selected components, no theme, no unocss, no strings',
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
    ...(p.i18n ? { i18nLocales: [...p.i18n.locales] } : {}),
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

  const diagnostics = collectDiagnostics(
    resolution.providers,
    components,
    skipped,
    resolution.themes.warnings,
    tokenConflicts,
    undeclaredDependencies,
    computeDashPrefixedTokens(resolution, options.themes),
    inspectI18nSubpaths(resolution.providers),
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
      + `${p.hasTheme ? ', theme: yes' : ''}${p.hasUnocss ? ', unocss: yes' : ''}`
      + `${p.i18nLocales ? `, i18n: ${p.i18nLocales.join('/')}` : ''}`)
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
