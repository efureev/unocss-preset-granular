import type { GranularComponentDependency, GranularProvider } from './contract'
import type { ResolvedThemeWarning, ThemeNamesSource } from './core/resolveThemes'
import type { ResolvedScanDir, SkippedScanDir } from './fs/resolveScanDirs'
import type { resolvePresetGranular } from './preset'

import type { PresetGranularNodeOptions } from './preset.node'
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

/** Уровень диагностики. `error` роняет `doctor`, `warn` — только с `--strict`. */
export type DoctorDiagnosticLevel = 'error' | 'warn'

/**
 * Машиночитаемый вид проблемы:
 *   - `layout-contract` — компонент не попал в скан (единственный `error`);
 *   - `theme-warning` — предупреждение резолва тем (`ResolvedThemeWarning`);
 *   - `token-conflict` — токен задаётся несколькими слоями;
 *   - `unused-provider` — провайдер в сборке не даёт ей ничего.
 */
export type DoctorDiagnosticCode
  = | 'layout-contract'
    | 'theme-warning'
    | 'token-conflict'
    | 'unused-provider'

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

/** Причина, по которой компонент не попал в скан — общая для отчёта и диагностик. */
const REASON_TEXT: Record<DoctorMissingDir['reason'], string> = {
  'missing-dir': 'директория отсутствует',
  'missing-entry': 'нет index.js',
  'invalid-base-url': 'некорректный packageBaseUrl',
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
 */
function collectDiagnostics(
  providers: readonly GranularProvider[],
  components: readonly DoctorComponentInfo[],
  missing: readonly DoctorMissingDir[],
  themeWarnings: readonly ResolvedThemeWarning[],
  tokenConflicts: readonly DoctorTokenConflict[],
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
      message: `${t.selector} { --${t.token} } задаётся несколькими слоями `
        + `(${t.sources.join(' → ')}), победило ${t.finalValue}`,
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
      message: 'провайдер ничего не даёт сборке: ни выбранных компонентов, ни theme, ни unocss',
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

  const diagnostics = collectDiagnostics(
    resolution.providers,
    components,
    skipped,
    resolution.themes.warnings,
    tokenConflicts,
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
  'app-defined': 'ключи themes.define',
  'provider-defaults': 'defaultThemes провайдеров',
  'fallback': 'фолбэк ядра',
}

const EXTENDS_REASON_TEXT: Record<'unknown' | 'opaque', string> = {
  unknown: 'такой темы не поставляет никто',
  opaque: 'тема приходит готовым CSS-файлом, её значения пресету не видны',
}

function formatThemeWarning(w: ResolvedThemeWarning): string {
  switch (w.kind) {
    case 'theme-extends-unresolved':
      return `тема "${w.theme}" наследует "${w.base}", но унаследовать нечего: `
        + `${EXTENDS_REASON_TEXT[w.reason]}`
    case 'theme-extends-cycle':
      return `цикл в themes.define[].extends: ${w.chain.join(' → ')} — цепочка оборвана`
    case 'default-theme-without-source':
      return `${w.providerId} объявил "${w.theme}" в defaultThemes, но не поставляет её `
        + '(нет ни themes[name], ни tokenDefinitions[name])'
    case 'partial-theme':
      return `тема "${w.theme}" покрыта не всеми провайдерами — без неё: ${w.providersWithout.join(', ')}`
    case 'multiple-default-themes':
      return `по умолчанию активировано несколько тем: [${w.themes.join(', ')}] — `
        + 'их блоки эмитятся одновременно; при пересекающихся селекторах победит последняя'
  }
}

/** Рендерит {@link DoctorReport} в человекочитаемый многострочный текст. */
export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = []
  const push = (s = ''): void => void lines.push(s)

  push('granular doctor')
  push('===============')
  push()

  push(`Провайдеры (${report.providers.length}):`)
  for (const p of report.providers) {
    push(`  • ${p.id} — компонентов: ${p.components}`
      + `${p.hasTheme ? ', theme: да' : ''}${p.hasUnocss ? ', unocss: да' : ''}`)
  }
  push()

  push(`Выбранные компоненты (${report.components.length}, порядок = deps → зависящие):`)
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

  push(`Темы: [${report.themes.names.join(', ') || '—'}] (${NAMES_SOURCE_TEXT[report.themes.namesSource]})`)
  for (const b of report.themes.blocks)
    push(`  • ${b.theme} → ${b.selector} (${b.tokens} токен(ов))`)
  for (const w of report.themes.warnings)
    push(`  ⚠ ${formatThemeWarning(w)}`)
  push()

  if (report.tokenConflicts.length) {
    push(`Конфликты токенов (${report.tokenConflicts.length}) — значение задаётся несколькими слоями:`)
    for (const t of report.tokenConflicts)
      push(`  • [${t.theme}] ${t.selector} { --${t.token} } ← ${t.sources.join(' → ')} = ${t.finalValue}`)
    push()
  }

  push(`Скан-globs (${report.scan.globs.length}):`)
  for (const g of report.scan.globs)
    push(`  • ${g}`)
  push()

  if (report.scan.missing.length) {
    push(`⚠ Проблемы layout-контракта (${report.scan.missing.length}):`)
    for (const m of report.scan.missing)
      push(`  • ${m.providerId}:${m.componentName} — ${REASON_TEXT[m.reason]} (${m.expectedDir})`)
    push()
  }

  const { errors, warnings } = countDoctorDiagnostics(report)

  if (report.diagnostics.length) {
    push(`Итоги диагностики (ошибок: ${errors}, предупреждений: ${warnings}):`)
    for (const d of report.diagnostics)
      push(`  ${d.level === 'error' ? '✗' : '⚠'} [${d.code}] ${d.subject} — ${d.message}`)
    push()
  }

  if (!report.ok)
    push(`✗ Найдены нарушения layout-контракта: ${report.scan.missing.length}.`)
  else if (warnings)
    push(`✓ OK — нарушений layout-контракта не найдено; предупреждений: ${warnings} (падают только с --strict).`)
  else
    push('✓ OK — нарушений layout-контракта не найдено.')

  return lines.join('\n')
}
