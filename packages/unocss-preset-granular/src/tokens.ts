import type { ComponentKey, ComponentRegistry } from './core/registry'
import type { TokenChain, TokenLayerValue } from './core/tokenLayers'
import type { TokenUsageVia } from './fs/tokenUsage'

import type { PresetGranularNodeOptions } from './preset.node'
import { relative } from 'node:path'
import { buildRegistry, resolveComponentTarget, splitComponentKey } from './core/registry'
import { collectDependencyClosure } from './core/resolveSelection'
import { collectTokenLayers } from './core/tokenLayers'
import { inspectGranularTokenUsage } from './fs/tokenUsage'
import { inspectGranularScanDirs, resolveGranularNode } from './preset.node'

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

/**
 * Кем объявлен токен — НИЖНИЙ слой его цепочки, относительно ЦЕЛЕВОГО
 * компонента отчёта. Это и есть ответ на «где мои токены, а где общие».
 */
export type TokenOrigin
  /** Объявлен самим целевым компонентом. */
  = | 'own'
  /** Объявлен ДРУГИМ компонентом сборки — неявная связь через токен. */
    | 'component'
  /** `provider.theme.tokenDefinitions` — общие токены дизайн-системы. */
    | 'provider'
  /** `themes.define` или `themes.tokenOverrides` — пришёл от приложения. */
    | 'app'
  /** Ни один слой, известный granular, его не задаёт. */
    | 'none'

/** Цепочка слоёв одного токена в одной теме. */
export interface TokensValueChain {
  theme: string
  selector: string
  layers: TokenLayerValue[]
  /** `undefined` ⇒ токена в эмитируемом CSS нет. */
  effective?: string
}

/** Токен, который компонент ПОТРЕБЛЯЕТ. */
export interface TokensUsage {
  /** Имя БЕЗ префикса `--`. */
  token: string
  origin: TokenOrigin
  /** Кто объявил: ключ компонента или `provider:<id>` / `app-theme`. */
  declaredBy?: string
  /** Компоненты из scope отчёта, потребляющие токен. */
  usedBy: string[]
  /** Выбранные компоненты ВНЕ scope, потребляющие тот же токен. */
  alsoUsedBy: string[]
  via: TokenUsageVia[]
  files: string[]
  hasFallback: boolean
  /** Пусто ⇔ `origin === 'none'`. */
  values: TokensValueChain[]
}

/** Токен, который компонент ОБЪЯВЛЯЕТ. */
export interface TokensDeclaration {
  token: string
  theme: string
  selector: string
  /** Ключ компонента-объявителя (при `--deep` это может быть под-компонент). */
  declaredBy: string
  /** Значение, объявленное ЭТИМ компонентом. */
  value: string
  layers: TokenLayerValue[]
  effective?: string
  /** Значение компонента перебито слоем выше. */
  overridden: boolean
  /** Ни одного потребления в scope granular не нашёл. */
  unusedInScope: boolean
}

export interface TokensReport {
  key: string
  providerId: string
  name: string
  /** `own` — только целевой компонент; `deep` — он и его зависимости. */
  scope: 'own' | 'deep'
  /** Компоненты, вошедшие в scope (при `own` — один). */
  components: string[]
  included: boolean
  declares: TokensDeclaration[]
  uses: TokensUsage[]
  scanned: { safelist: number, cssFiles: number, sourceFiles: number, dirs: number }
  /** `false` — скан исходников выключен или директории не резолвнулись. */
  sourceScanActive: boolean
  /** Число токенов с `origin: 'none'`. */
  undefinedCount: number
  /** Заполнено, если имя не резолвится: что вообще объявлено. */
  available?: string[]
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

/** Происхождение по метке нижнего слоя цепочки. */
function originOf(source: string, targetKey: string, providerId: string): { origin: TokenOrigin, declaredBy: string } {
  if (source === 'app-theme' || source === 'app-override')
    return { origin: 'app', declaredBy: source }
  if (source.startsWith('component:')) {
    const key = `${providerId}:${source.slice('component:'.length)}`
    return { origin: key === targetKey ? 'own' : 'component', declaredBy: key }
  }
  return { origin: 'provider', declaredBy: source }
}

const ORIGIN_RANK: Record<TokenOrigin, number> = {
  own: 0,
  component: 1,
  provider: 2,
  app: 3,
  none: 4,
}

function emptyReport(key: string, available: string[]): TokensReport {
  const [providerId, name] = key.includes(':') ? splitComponentKey(key) : ['', key]
  return {
    key,
    providerId,
    name,
    scope: 'own',
    components: [],
    included: false,
    declares: [],
    uses: [],
    scanned: { safelist: 0, cssFiles: 0, sourceFiles: 0, dirs: 0 },
    sourceScanActive: false,
    undefinedCount: 0,
    available,
  }
}

/**
 * Отвечает на вопрос «какие токены нужны этому компоненту и откуда берутся их
 * значения»: что он объявляет сам, что потребляет через `var(--…)`, кто задал
 * итоговое значение и кого ещё заденет правка.
 *
 * Резолвит через тот же {@link resolveGranularNode}, что и пресет, а значения
 * берёт из той же раскладки слоёв, из которой эмитится CSS — поэтому отчёт
 * описывает ровно ту сборку, которая уедет в прод.
 */
export function granularTokens(
  options: PresetGranularNodeOptions,
  target: string,
  scopeOption: 'own' | 'deep' = 'own',
): TokensReport {
  const resolution = resolveGranularNode(options)
  const registry: ComponentRegistry = buildRegistry(resolution.providers)

  const resolved = resolveComponentTarget(target, registry)
  if ('ambiguous' in resolved) {
    return emptyReport(
      target,
      resolved.ambiguous.length ? resolved.ambiguous : [...registry.components.keys()],
    )
  }

  const key = resolved.key
  const [providerId, name] = splitComponentKey(key)
  const entry = registry.components.get(key)
  if (!entry) {
    return emptyReport(key, registry.providers.has(providerId)
      ? registry.getComponentsOfProvider(providerId).map(d => `${providerId}:${d.name}`)
      : [...registry.components.keys()])
  }

  const included = resolution.resolved.order.includes(key)

  // Scope: сам компонент либо его транзитивное замыкание.
  const scopeKeys: ComponentKey[] = scopeOption === 'deep'
    ? [...collectDependencyClosure(registry, key)]
    : [key]
  const scope = new Set<string>(scopeKeys)

  const layers = collectTokenLayers(resolution.themes, options.themes?.tokenOverrides, {
    strictTokens: options.themes?.strictTokens,
  })
  const usageIndex = inspectGranularTokenUsage(
    options,
    resolution,
    inspectGranularScanDirs(options).dirs,
  )

  // --- Потребление -------------------------------------------------------
  const uses: TokensUsage[] = []
  for (const [token, byComponent] of usageIndex.usage) {
    const usedBy = [...byComponent.keys()].filter(k => scope.has(k)).sort()
    if (usedBy.length === 0)
      continue

    const via: TokenUsageVia[] = []
    const files: string[] = []
    let hasFallback = false
    for (const k of usedBy) {
      const found = byComponent.get(k)!
      for (const channel of found.via) {
        if (!via.includes(channel))
          via.push(channel)
      }
      for (const file of found.files) {
        if (!files.includes(file))
          files.push(file)
      }
      hasFallback = hasFallback || found.hasFallback
    }

    // Значения по всем активным темам, где токен вообще задан.
    const values: TokensValueChain[] = []
    let origin: TokenOrigin = 'none'
    let declaredBy: string | undefined
    for (const [theme, blocks] of layers) {
      for (const block of blocks) {
        const chain = block.tokens.get(token)
        if (!chain)
          continue
        values.push({
          theme,
          selector: block.selector,
          layers: chain.layers,
          ...(chain.effective !== undefined ? { effective: chain.effective } : {}),
        })
        const bottom = chain.layers[0]
        if (bottom) {
          const candidate = originOf(bottom.source, key, providerId)
          // Из нескольких тем берём «самое своё» происхождение; полные
          // цепочки остаются в `values`, так что расхождение видно.
          if (ORIGIN_RANK[candidate.origin] < ORIGIN_RANK[origin]) {
            origin = candidate.origin
            declaredBy = candidate.declaredBy
          }
        }
      }
    }

    uses.push({
      token,
      origin,
      ...(declaredBy !== undefined ? { declaredBy } : {}),
      usedBy,
      alsoUsedBy: [...byComponent.keys()].filter(k => !scope.has(k)).sort(),
      via,
      files,
      hasFallback,
      values,
    })
  }
  uses.sort((a, b) => ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin] || a.token.localeCompare(b.token))

  // --- Объявления --------------------------------------------------------
  const declares: TokensDeclaration[] = []
  for (const item of resolution.themes.items) {
    if (!item.componentName || !item.tokenDefinition)
      continue
    const owner = `${item.providerId}:${item.componentName}`
    if (!scope.has(owner))
      continue

    const primary = resolution.themes.tokenRegistry[item.themeName]?.blocks[0]?.selector ?? ':root'
    const selector = item.tokenDefinition.selector ?? primary
    const block = layers.get(item.themeName)?.find(b => b.selector === selector)

    for (const [token, value] of Object.entries(item.tokenDefinition.tokens)) {
      const chain: TokenChain | undefined = block?.tokens.get(token)
      const effective = chain?.effective
      const consumers = usageIndex.usage.get(token)
      declares.push({
        token,
        theme: item.themeName,
        selector,
        declaredBy: owner,
        value,
        layers: chain?.layers ?? [{ source: `component:${item.componentName}`, value }],
        ...(effective !== undefined ? { effective } : {}),
        overridden: effective !== undefined && effective !== value,
        unusedInScope: ![...(consumers?.keys() ?? [])].some(k => scope.has(k)),
      })
    }
  }

  return {
    key,
    providerId,
    name,
    scope: scopeOption,
    components: [...scope].sort(),
    included,
    declares,
    uses,
    scanned: usageIndex.scanned,
    sourceScanActive: usageIndex.sourceScanActive,
    undefinedCount: uses.filter(u => u.origin === 'none').length,
  }
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

/**
 * Заголовки групп по происхождению. Порядок групп сам по себе есть ответ на
 * «где мои токены, а где общие»: своё → что связывает с соседом → что берётся
 * у дизайн-системы → что подсунуло приложение → чего не задаёт никто.
 */
const ORIGIN_TITLE: Record<TokenOrigin, string> = {
  own: 'declared by this component',
  component: 'declared by another component',
  provider: 'from the provider — design-system tokens',
  app: 'from the application',
  none: 'not defined by any granular layer',
}

/** Рендерит {@link TokensReport} в человекочитаемый многострочный текст. */
export function formatTokensReport(report: TokensReport, cwd: string): string {
  const lines: string[] = []
  const push = (s = ''): void => void lines.push(s)
  const short = (file: string): string => {
    const rel = relative(cwd, file)
    return rel && !rel.startsWith('..') ? rel : file
  }

  const header = `granular tokens ${report.key}`
  push(header)
  push('='.repeat(header.length))
  push()

  if (report.available) {
    push('Status: no provider declares such a component')
    push()
    push(`Known components (${report.available.length}):`)
    for (const key of report.available)
      push(`  • ${key}`)
    return lines.join('\n')
  }

  const scopeText = report.scope === 'deep'
    ? `this component and its dependencies (${report.components.length})`
    : 'this component only (--deep adds sub-components)'
  push(`Status: ${report.included ? 'in the build' : 'NOT in the build'}; scope: ${scopeText}`)

  // --- Declares ---
  push()
  push(`Declares (${report.declares.length}):${report.declares.length ? '' : ' —'}`)
  for (const declaration of report.declares) {
    const owner = declaration.declaredBy === report.key ? '' : ` (${declaration.declaredBy})`
    push(`  • --${declaration.token}${owner}  [${declaration.theme}] ${declaration.selector}`)
    push(`      ${formatChain(declaration.layers, declaration.effective)}`)
    if (declaration.unusedInScope)
      push(`      not used anywhere in scope`)
  }

  // --- Uses, grouped by origin ---
  push()
  push(`Uses (${report.uses.length}):${report.uses.length ? '' : ' —'}`)
  let currentOrigin: TokenOrigin | undefined
  for (const use of report.uses) {
    if (use.origin !== currentOrigin) {
      currentOrigin = use.origin
      const count = report.uses.filter(u => u.origin === use.origin).length
      push(`  ${ORIGIN_TITLE[use.origin]} (${count}):`)
    }

    const marker = use.origin === 'none' ? '⚠' : '•'
    const channels = use.via.join(', ')
    const fallback = use.origin === 'none' ? (use.hasFallback ? ' (has fallback)' : ' (no fallback)') : ''
    push(`    ${marker} --${use.token}  [${channels}]${fallback}`)

    for (const value of use.values)
      push(`        [${value.theme}] ${value.selector}  ${formatChain(value.layers, value.effective)}`)

    if (use.alsoUsedBy.length)
      push(`        also used by (${use.alsoUsedBy.length}): ${use.alsoUsedBy.join(', ')}`)
    if (report.scope === 'deep' && use.usedBy.length > 1)
      push(`        used in scope by: ${use.usedBy.join(', ')}`)
    for (const file of use.files.slice(0, 3))
      push(`        ${short(file)}`)
  }

  push()
  push(`Scanned: ${report.scanned.safelist} safelist entr(ies), ${report.scanned.cssFiles} CSS file(s), `
    + `${report.scanned.sourceFiles} source file(s) in ${report.scanned.dirs} director(ies).`)

  if (!report.sourceScanActive) {
    push()
    push('Source scan is inactive — only safelist and component CSS were checked.')
  }

  if (report.undefinedCount > 0) {
    push()
    push('Tokens in the last group may still be defined outside granular: by rules or')
    push('shortcuts of UnoCSS itself or of a provider (provider.unocss), by base/tokens/')
    push('theme CSS, or by the application — granular does not track those.')
  }

  return lines.join('\n')
}

/** `provider:p #aaa → app-override #ccc` с пометкой отброшенных слоёв. */
function formatChain(layers: readonly TokenLayerValue[], effective: string | undefined): string {
  const rendered = layers
    .map(layer => `${layer.source} ${layer.value}${layer.skipped ? ' (dropped by strictTokens)' : ''}`)
    .join(' → ')
  if (effective === undefined)
    return `${rendered} — not in the CSS`
  return rendered
}
