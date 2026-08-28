import type { ComponentKey, ComponentRegistry } from './core/registry'
import type { TokenChain, TokenLayerValue } from './core/tokenLayers'
import type { TokenUsageVia } from './fs/tokenUsage'

import type { PresetGranularNodeOptions } from './preset.node'
import { relative } from 'node:path'
import { buildRegistry, resolveComponentTarget, splitComponentKey } from './core/registry'
import { collectDependencyClosure } from './core/resolveSelection'
import { collectTokenLayers } from './core/tokenLayers'
import { inspectGranularTokenUsage } from './fs/tokenUsage'
import { collectInlinedTokens } from './node-utils/inlinedCss'
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
  /** Цепочки структурных слоёв. Пусто, если токен объявлен только файлом. */
  values: TokensValueChain[]
  /**
   * Значения, пришедшие из CSS, который пресет инлайнит целиком
   * (`tokensCssUrl`, `baseCssUrl`, файл темы).
   *
   * Отдельным полем, а не слоем в `values`: слоя такой файл не образует —
   * `tokenOverrides` на его токен не подействует, пока провайдер не поднимет
   * его до структурного через `tokenDefinitionsFromCss`. Смешать их значило бы
   * завести ещё одно понятие «значения по умолчанию» рядом с настоящими слоями.
   */
  inlined?: Array<{ source: string, selector: string, value: string, theme?: string }>
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
  /**
   * Почему имя не резолвится. `ambiguous` — компонент с таким именем есть у
   * НЕСКОЛЬКИХ провайдеров, и его надо квалифицировать; `unknown` — нет ни у
   * кого. Без этого различия отчёт на однозначно существующее имя писал бы
   * «такого компонента никто не объявляет» и отправлял искать опечатку.
   */
  unresolved?: 'ambiguous' | 'unknown'
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

/**
 * Происхождение по нижнему слою цепочки.
 *
 * Ключ компонента берётся из `layer.componentKey`, а не собирается из
 * providerId читателя: имена компонентов уникальны лишь внутри провайдера, и
 * склейка приписала бы чужое объявление целевому пакету.
 */
function originOf(layer: TokenLayerValue, targetKey: string): { origin: TokenOrigin, declaredBy: string } {
  if (layer.source === 'app-theme' || layer.source === 'app-override')
    return { origin: 'app', declaredBy: layer.source }
  if (layer.componentKey !== undefined)
    return { origin: layer.componentKey === targetKey ? 'own' : 'component', declaredBy: layer.componentKey }
  return { origin: 'provider', declaredBy: layer.source }
}

const ORIGIN_RANK: Record<TokenOrigin, number> = {
  own: 0,
  component: 1,
  provider: 2,
  app: 3,
  none: 4,
}

function emptyReport(key: string, available: string[], unresolved: 'ambiguous' | 'unknown'): TokensReport {
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
    unresolved,
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
    return resolved.ambiguous.length
      ? emptyReport(target, resolved.ambiguous, 'ambiguous')
      : emptyReport(target, [...registry.components.keys()], 'unknown')
  }

  const key = resolved.key
  const [providerId, name] = splitComponentKey(key)
  const entry = registry.components.get(key)
  if (!entry) {
    return emptyReport(key, registry.providers.has(providerId)
      ? registry.getComponentsOfProvider(providerId).map(d => `${providerId}:${d.name}`)
      : [...registry.components.keys()], 'unknown')
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
  // Токены инлайнимого CSS — вторая половина пространства: провайдер вправе
  // отдать всю палитру обычным `tokens.css`, и тогда структурных слоёв у него
  // нет вовсе. Без этого источника весь его набор попадал в группу «ничьих»,
  // расходясь с `doctor`, который такие токены из кандидатов вычитает.
  const inlinedTokens = collectInlinedTokens(options, resolution)

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
        // Нижний РЕАЛЬНО применённый слой. Цепочка, состоящая из одних
        // отброшенных `strictTokens` слоёв, происхождения не даёт: токена в
        // CSS нет, и назвать его «пришедшим от приложения» значило бы
        // разойтись с `doctor`, который считает такой токен неопределённым.
        const bottom = chain.layers.find(l => l.skipped === undefined)
        if (bottom) {
          const candidate = originOf(bottom, key)
          // Из нескольких тем берём «самое своё» происхождение; полные
          // цепочки остаются в `values`, так что расхождение видно.
          if (ORIGIN_RANK[candidate.origin] < ORIGIN_RANK[origin]) {
            origin = candidate.origin
            declaredBy = candidate.declaredBy
          }
        }
      }
    }

    // Токен без структурных слоёв мог прийти инлайнимым файлом. Владелец
    // файла и определяет группу: провайдерский `tokens.css` — общий токен
    // дизайн-системы, подменённый приложением — токен приложения.
    const inlined = origin === 'none' ? inlinedTokens.get(token) : undefined
    if (inlined) {
      origin = inlined.owner === 'app' ? 'app' : 'provider'
      declaredBy = inlined.origin
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
      ...(inlined
        ? {
            inlined: [{
              source: inlined.origin,
              selector: inlined.selector,
              value: inlined.value,
              ...(inlined.theme !== undefined ? { theme: inlined.theme } : {}),
            }],
          }
        : {}),
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
    push(report.unresolved === 'ambiguous'
      ? 'Status: several providers declare a component with this name — qualify it as providerId:Name'
      : 'Status: no provider declares such a component')
    push()
    push(`${report.unresolved === 'ambiguous' ? 'Matching' : 'Known'} components (${report.available.length}):`)
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
  // Размеры групп — одним проходом: `uses` уже отсортирован по происхождению,
  // а пересчёт `filter` на каждом заголовке перечитывал бы весь список пять раз.
  const groupSize = new Map<TokenOrigin, number>()
  for (const use of report.uses)
    groupSize.set(use.origin, (groupSize.get(use.origin) ?? 0) + 1)

  let currentOrigin: TokenOrigin | undefined
  for (const use of report.uses) {
    if (use.origin !== currentOrigin) {
      currentOrigin = use.origin
      push(`  ${ORIGIN_TITLE[use.origin]} (${groupSize.get(use.origin)}):`)
    }

    const marker = use.origin === 'none' ? '⚠' : '•'
    const channels = use.via.join(', ')
    const fallback = use.origin === 'none' ? (use.hasFallback ? ' (has fallback)' : ' (no fallback)') : ''
    push(`    ${marker} --${use.token}  [${channels}]${fallback}`)

    for (const value of use.values)
      push(`        [${value.theme}] ${value.selector}  ${formatChain(value.layers, value.effective)}`)

    // Значения из инлайнимого CSS печатаются той же строкой, что и цепочки, но
    // без стрелок: слоёв у них нет — это одно объявление в одном файле.
    for (const value of use.inlined ?? []) {
      push(`        ${value.theme !== undefined ? `[${value.theme}] ` : ''}${value.selector}  `
        + `${value.source} ${value.value}`)
    }

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
    push('shortcuts of UnoCSS itself or of a provider (provider.unocss), or by the')
    push('application\'s own CSS — granular does not track those. Inlined base/tokens/')
    push('theme CSS it does track, so tokens declared there are not in this group.')
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
