import type { GranularComponentDependency } from './contract'
import type { ResolvedThemeWarning, ThemeNamesSource } from './core/resolveThemes'
import type { ResolvedScanDir, SkippedScanDir } from './fs/resolveScanDirs'
import type { PresetGranularNodeOptions } from './preset.node'

import { resolvePresetGranular } from './preset'
import { inspectGranularScanDirs, resolveGranularFilesystemGlobs } from './preset.node'

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

export interface DoctorProviderInfo {
  id: string
  /** Кол-во объявленных компонентов у провайдера (не обязательно выбранных). */
  components: number
  hasTheme: boolean
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
  /** `true`, если нет проблем layout-контракта (`scan.missing` пуст). */
  ok: boolean
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
    const source = item.componentName ? `component:${item.componentName}` : `provider:${item.providerId}`
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

/**
 * Собирает диагностический отчёт по granular-конфигурации: резолвнутые
 * провайдеры, транзитивный граф выбранных компонентов, блоки токенов тем,
 * конфликты токенов между слоями, итоговые скан-globs и отсутствующие
 * `components/<Name>/` директории (нарушения layout-контракта).
 *
 * Чистая относительно опций (только читает FS для проверки директорий).
 */
export function granularDoctor(options: PresetGranularNodeOptions): DoctorReport {
  const resolution = resolvePresetGranular(options)

  const providers: DoctorProviderInfo[] = resolution.providers.map(p => ({
    id: p.id,
    components: p.components.length,
    hasTheme: !!p.theme,
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
    ok: skipped.length === 0,
  }
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

const NAMES_SOURCE_TEXT: Record<ThemeNamesSource, string> = {
  'explicit': 'themes.names',
  'provider-defaults': 'defaultThemes провайдеров',
  'fallback': 'фолбэк ядра',
}

function formatThemeWarning(w: ResolvedThemeWarning): string {
  switch (w.kind) {
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

const REASON_TEXT: Record<DoctorMissingDir['reason'], string> = {
  'missing-dir': 'директория отсутствует',
  'missing-entry': 'нет index.js',
  'invalid-base-url': 'некорректный packageBaseUrl',
}

/** Рендерит {@link DoctorReport} в человекочитаемый многострочный текст. */
export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = []
  const push = (s = ''): void => void lines.push(s)

  push('granular doctor')
  push('===============')
  push()

  push(`Провайдеры (${report.providers.length}):`)
  for (const p of report.providers)
    push(`  • ${p.id} — компонентов: ${p.components}${p.hasTheme ? ', theme: да' : ''}`)
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

  push(report.ok
    ? '✓ OK — нарушений layout-контракта не найдено.'
    : `✗ Найдены нарушения layout-контракта: ${report.scan.missing.length}.`)

  return lines.join('\n')
}
