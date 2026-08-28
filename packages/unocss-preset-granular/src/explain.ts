import type { ComponentKey, ComponentRegistry } from './core/registry'
import type { ResolvedScanDir, SkippedScanDir } from './fs/resolveScanDirs'

import type { PresetGranularNodeOptions } from './preset.node'
import { buildRegistry, resolveComponentTarget, splitComponentKey } from './core/registry'
import { normalizeDependency, normalizeSelection } from './core/resolveSelection'
import { collectTokenLayers } from './core/tokenLayers'
import { inspectGranularScanDirs, resolveGranularNode } from './preset.node'

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

/** Почему компонент оказался (или не оказался) в сборке. */
export type ExplainReason
  /** Перечислен в `options.components` напрямую. */
  = | 'selected'
  /** Притянут как транзитивная `dependencies` другого компонента. */
    | 'dependency'
  /** Объявлен провайдером, но в сборку не попал. */
    | 'not-selected'
  /** Такого компонента не объявлял никто. */
    | 'unknown'

/** Вклад компонента в токены одной темы. */
export interface ExplainTokenContribution {
  theme: string
  /** Селектор, под который уходит вклад (`undefined` у дескриптора → первичный блок темы). */
  selector: string
  tokens: Array<{
    name: string
    /** Значение, которое объявил ЭТОТ компонент. */
    value: string
    /** Итоговое значение токена в сборке — отличается, если его перебил слой выше. */
    effective: string
    /** `true`, если значение компонента перебито (`effective !== value`). */
    overridden: boolean
  }>
}

/** CSS-файл, объявленный компонентом. */
export interface ExplainCssFile {
  url: string
  assetName?: string
  /**
   * `undefined` — файл эмитится от имени этого компонента; иначе ключ
   * компонента, который объявил тот же URL раньше (дедуп по URL в
   * `collectCssFilesDetailed` оставляет только первое вхождение).
   */
  dedupedInto?: string
}

export interface ExplainReport {
  /** Квалифицированный ключ `providerId:Name` (как его понял резолвер). */
  key: string
  providerId: string
  name: string
  reason: ExplainReason
  /** Попал ли компонент в сборку. */
  included: boolean
  /**
   * Кратчайшая цепочка от корня селекции до компонента, включая его самого.
   * Для `reason: 'selected'` — один элемент. Пусто, если компонент не в сборке.
   */
  chain: string[]
  /** Прямые зависимости компонента (квалифицированные ключи). */
  dependencies: string[]
  /** Выбранные компоненты, которые зависят от него напрямую. */
  requiredBy: string[]
  group?: string
  safelist: string[]
  cssFiles: ExplainCssFile[]
  tokens: ExplainTokenContribution[]
  /** Директории, уходящие в `content.filesystem` из-за этого компонента. */
  scanDirs: ResolvedScanDir[]
  /** Заполнено, если компонент отвалился по layout-контракту. */
  scanSkipped?: SkippedScanDir
  /**
   * Заполнено при `reason: 'unknown'` — что провайдер (или все провайдеры)
   * вообще объявляют. Ровно та же подсказка, что и в `ComponentNotFoundError`.
   */
  available?: string[]
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

/** Прямые зависимости записи реестра в квалифицированной форме. */
function directDependencies(registry: ComponentRegistry, key: ComponentKey): ComponentKey[] {
  const entry = registry.components.get(key)
  if (!entry)
    return []
  const keys: ComponentKey[] = []
  for (const dep of entry.descriptor.dependencies ?? [])
    keys.push(...normalizeDependency(dep, entry.provider.id))
  return keys
}

/**
 * Кратчайшая цепочка «корень селекции → … → target» по графу `dependencies`.
 *
 * Обход в ширину именно от корней: вопрос `explain` — «кто его сюда притащил»,
 * и короткий ответ полезнее полного дерева путей. Первый найденный путь при
 * BFS и есть кратчайший.
 */
function shortestChain(
  registry: ComponentRegistry,
  seeds: readonly ComponentKey[],
  target: ComponentKey,
): ComponentKey[] {
  const previous = new Map<ComponentKey, ComponentKey | undefined>()
  const queue: ComponentKey[] = []

  for (const seed of seeds) {
    if (previous.has(seed))
      continue
    previous.set(seed, undefined)
    queue.push(seed)
  }

  let head = 0
  while (head < queue.length) {
    const key = queue[head++]
    if (key === target)
      break
    for (const dep of directDependencies(registry, key)) {
      if (previous.has(dep))
        continue
      previous.set(dep, key)
      queue.push(dep)
    }
  }

  if (!previous.has(target))
    return []

  const chain: ComponentKey[] = []
  let cursor: ComponentKey | undefined = target
  while (cursor !== undefined) {
    chain.unshift(cursor)
    cursor = previous.get(cursor)
  }
  return chain
}

/**
 * Отвечает на вопрос «почему этот компонент в сборке и что он в неё приносит»:
 * цепочка от корня селекции, обратные зависимости, safelist, CSS-файлы, вклад
 * в токены тем и скан-директории.
 *
 * Резолвит через тот же {@link resolveGranularNode}, что и пресет, — значит
 * описывает ровно ту сборку, которая поедет в CSS, а не отдельно посчитанную.
 */
export function granularExplain(
  options: PresetGranularNodeOptions,
  target: string,
): ExplainReport {
  const resolution = resolveGranularNode(options)
  const registry = buildRegistry(resolution.providers)

  const resolved = resolveComponentTarget(target, registry)
  if ('ambiguous' in resolved) {
    return {
      key: target,
      providerId: '',
      name: target,
      reason: 'unknown',
      included: false,
      chain: [],
      dependencies: [],
      requiredBy: [],
      safelist: [],
      cssFiles: [],
      tokens: [],
      scanDirs: [],
      available: resolved.ambiguous.length
        ? resolved.ambiguous
        : [...registry.components.keys()],
    }
  }

  const key = resolved.key
  const [providerId, name] = splitComponentKey(key)
  const entry = registry.components.get(key)

  if (!entry) {
    return {
      key,
      providerId,
      name,
      reason: 'unknown',
      included: false,
      chain: [],
      dependencies: [],
      requiredBy: [],
      safelist: [],
      cssFiles: [],
      tokens: [],
      scanDirs: [],
      available: registry.providers.has(providerId)
        ? registry.getComponentsOfProvider(providerId).map(d => `${providerId}:${d.name}`)
        : [...registry.components.keys()],
    }
  }

  const { descriptor } = entry
  const included = resolution.resolved.order.includes(key)

  // Корни селекции: `normalizeSelection` уже бросил бы на неизвестном
  // провайдере при резолюции выше, так что здесь он безопасен.
  const seeds = normalizeSelection(options.components, registry)
  const isSeed = seeds.includes(key)
  const chain = included && !isSeed ? shortestChain(registry, seeds, key) : (isSeed ? [key] : [])

  const requiredBy = resolution.resolved.order.filter(
    other => other !== key && directDependencies(registry, other).includes(key),
  )

  // Дедуп CSS идёт по URL и оставляет ПЕРВОЕ вхождение — значит файл может
  // эмититься от имени другого компонента. Для отладки «почему мой CSS не
  // подключился» это ровно тот факт, который нужен.
  const cssOwners = new Map(resolution.cssFiles.map(f => [f.url, `${f.providerId}:${f.componentName}`]))
  const cssFiles: ExplainCssFile[] = (descriptor.cssFiles ?? []).map((url, index) => {
    const owner = cssOwners.get(url)
    return {
      url,
      ...(descriptor.cssFileAssetNames?.[index] ? { assetName: descriptor.cssFileAssetNames[index] } : {}),
      ...(owner && owner !== key ? { dedupedInto: owner } : {}),
    }
  })

  // Итоговые значения берутся из общей раскладки слоёв, а не из
  // `tokenRegistry`: `themes.tokenOverrides` в реестр не входит, он
  // применяется на эмиссии CSS. Считая по реестру, отчёт показывал бы
  // до-override значение и `overridden: false` там, где приложение токен
  // как раз перебило.
  const layers = collectTokenLayers(resolution.themes, options.themes?.tokenOverrides, {
    strictTokens: options.themes?.strictTokens,
  })

  const tokens: ExplainTokenContribution[] = []
  for (const item of resolution.themes.items) {
    if (item.componentName !== name || item.providerId !== providerId || !item.tokenDefinition)
      continue
    const registryEntry = resolution.themes.tokenRegistry[item.themeName]
    const selector = item.tokenDefinition.selector ?? registryEntry?.blocks[0]?.selector ?? ':root'
    const block = layers.get(item.themeName)?.find(b => b.selector === selector)
    tokens.push({
      theme: item.themeName,
      selector,
      tokens: Object.entries(item.tokenDefinition.tokens).map(([tokenName, value]) => {
        const effective = block?.tokens.get(tokenName)?.effective ?? value
        return { name: tokenName, value, effective, overridden: effective !== value }
      }),
    })
  }

  const inspection = inspectGranularScanDirs(options)
  const scanSkipped = inspection.skipped.find(
    s => s.providerId === providerId && s.componentName === name,
  )

  return {
    key,
    providerId,
    name,
    reason: included ? (isSeed ? 'selected' : 'dependency') : 'not-selected',
    included,
    chain,
    dependencies: directDependencies(registry, key),
    requiredBy: [...requiredBy],
    ...(descriptor.group ? { group: descriptor.group } : {}),
    safelist: [...(descriptor.safelist ?? [])],
    cssFiles,
    tokens,
    scanDirs: inspection.dirs.filter(d => d.providerId === providerId && d.componentName === name),
    ...(scanSkipped ? { scanSkipped } : {}),
  }
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

const REASON_TEXT: Record<ExplainReason, string> = {
  'selected': 'listed in options.components',
  'dependency': 'pulled in as a dependency',
  'not-selected': 'declared by its provider but NOT part of the build',
  'unknown': 'no provider declares such a component',
}

const SKIP_REASON_TEXT: Record<SkippedScanDir['reason'], string> = {
  'missing-dir': 'directory is missing',
  'missing-entry': 'index.js is missing',
  'invalid-base-url': 'invalid packageBaseUrl',
}

/** Рендерит {@link ExplainReport} в человекочитаемый многострочный текст. */
export function formatExplainReport(report: ExplainReport): string {
  const lines: string[] = []
  const push = (s = ''): void => void lines.push(s)

  push(`granular explain ${report.key}`)
  push('='.repeat(`granular explain ${report.key}`.length))
  push()

  push(`Status: ${report.included ? 'in the build' : 'NOT in the build'} — ${REASON_TEXT[report.reason]}`)

  if (report.reason === 'unknown') {
    push()
    push(`Known components (${report.available?.length ?? 0}):`)
    for (const key of report.available ?? [])
      push(`  • ${key}`)
    return lines.join('\n')
  }

  if (report.chain.length > 1) {
    push()
    push('Chain from the selection root:')
    push(`  ${report.chain.join(' → ')}`)
  }

  push()
  push(`Dependencies (${report.dependencies.length}):`)
  for (const dep of report.dependencies)
    push(`  • ${dep}`)

  push()
  push(`Required by (${report.requiredBy.length}):`)
  for (const dep of report.requiredBy)
    push(`  • ${dep}`)

  push()
  push(`Contributes to the build:`)
  push(`  safelist (${report.safelist.length}): ${report.safelist.join(', ') || '—'}`)
  push(`  cssFiles (${report.cssFiles.length}):${report.cssFiles.length ? '' : ' —'}`)
  for (const file of report.cssFiles) {
    push(`    • ${file.url}${file.assetName ? ` (asset: ${file.assetName})` : ''}`
      + `${file.dedupedInto ? ` — deduplicated into ${file.dedupedInto}` : ''}`)
  }
  push(`  tokens (${report.tokens.length} theme(s)):${report.tokens.length ? '' : ' —'}`)
  for (const contribution of report.tokens) {
    push(`    • [${contribution.theme}] ${contribution.selector}`)
    for (const token of contribution.tokens) {
      push(`        --${token.name}: ${token.value}`
        + `${token.overridden ? ` (overridden → ${token.effective})` : ''}`)
    }
  }
  if (report.group)
    push(`  group: ${report.group}`)

  push()
  push(`Scan directories (${report.scanDirs.length}):${report.scanDirs.length ? '' : ' —'}`)
  for (const dir of report.scanDirs)
    push(`  • ${dir.dir}${dir.kind === 'group-shared' ? ' (group shared)' : ''}`)

  if (report.scanSkipped) {
    push()
    push(`⚠ Not scanned: ${SKIP_REASON_TEXT[report.scanSkipped.reason]} `
      + `(${report.scanSkipped.expectedDir})`)
  }

  return lines.join('\n')
}
