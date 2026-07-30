import type { GranularComponentDescriptor, GranularProvider, GranularThemeTokenSet } from '../contract'

/**
 * Последний рубеж: если `names` не передан И ни один провайдер не объявил
 * `theme.defaultThemes` — грузим только `light`.
 */
export const GRANULAR_DEFAULT_THEME_NAMES = ['light'] as const

export interface ResolveThemesInput {
  /**
   * Явный список тем.
   *
   *   - `undefined` — имена берутся из `theme.defaultThemes` провайдеров
   *     (объединение в порядке провайдеров, дедуп), а если их никто не
   *     объявил — из {@link GRANULAR_DEFAULT_THEME_NAMES};
   *   - `[]` — тем нет вообще (это НЕ то же самое, что `undefined`).
   */
  names?: readonly string[]
}

/** Откуда взялся итоговый `names`. */
export type ThemeNamesSource
  /** `input.names` задан приложением явно. */
  = | 'explicit'
  /** Объединение `theme.defaultThemes` провайдеров. */
    | 'provider-defaults'
  /** Никто ничего не объявил — жёсткий фолбэк `['light']`. */
    | 'fallback'

/**
 * Диагностика резолва тем. Ошибок не бросает: набор тем — это конфигурация,
 * а не нарушение контракта. Потребитель — `granular doctor`.
 */
export type ResolvedThemeWarning
  /**
   * Провайдер объявил тему в `defaultThemes`, но сам её не поставляет
   * (нет ни `themes[name]`, ни `tokenDefinitions[name]`) — ошибка автора
   * пакета: тема активируется для ВСЕХ, а вклада от него не будет.
   */
  = | { kind: 'default-theme-without-source', providerId: string, theme: string }
  /**
   * Активная тема есть не у всех провайдеров, объявивших `theme`. Компоненты
   * «отставших» провайдеров в этой теме останутся без токенов.
   */
    | { kind: 'partial-theme', theme: string, providersWithout: readonly string[] }
  /**
   * По умолчанию (без `themes.names`) активирована больше чем одна тема —
   * их блоки эмитятся ОДНОВРЕМЕННО, и если селекторы пересекаются
   * (обе пишут в `:root`), выигрывает последняя по каскаду.
   */
    | { kind: 'multiple-default-themes', themes: readonly string[] }

export interface ResolvedThemeItem {
  providerId: string
  themeName: string
  cssUrl?: string
  tokenDefinition?: GranularThemeTokenSet
  /**
   * Если этот item пришёл от компонента (а не от провайдера) —
   * здесь указано имя компонента-источника. Для провайдерских items — undefined.
   */
  componentName?: string
}

/** Один CSS-блок токенов темы под конкретным селектором. */
export interface ResolvedThemeSelectorBlock {
  selector: string
  tokens: Record<string, string>
}

/**
 * Разрешённые токены одной темы.
 *
 * Тема может содержать НЕСКОЛЬКО блоков под разными селекторами (например,
 * один провайдер эмитит токены под `.dark`, другой — под `[data-theme="dark"]`).
 * Раньше все токены темы схлопывались в один селектор; теперь они группируются
 * по селектору в `blocks` (в порядке первого появления).
 *
 * Поля `selector`/`tokens` — это алиас «первичного» (первого) блока, сохранённый
 * для обратной совместимости и как цель для «плоских» `tokenOverrides`.
 */
export interface ResolvedThemeTokens {
  /** Селектор первичного блока (первого встреченного). */
  selector: string
  /** Токены первичного блока (та же ссылка, что `blocks[0].tokens`). */
  tokens: Record<string, string>
  /** Все блоки темы по селекторам, в порядке первого появления. */
  blocks: ResolvedThemeSelectorBlock[]
}

export interface ResolvedThemes {
  names: readonly string[]
  items: ResolvedThemeItem[]
  /** Слитый реестр токенов по темам: themeName -> { selector, tokens, blocks } */
  tokenRegistry: Record<string, ResolvedThemeTokens>
  /** Откуда взялся `names` — для диагностики (`granular doctor`). */
  namesSource: ThemeNamesSource
  /** Подозрительные, но не фатальные ситуации. Пустой массив — всё чисто. */
  warnings: readonly ResolvedThemeWarning[]
}

/**
 * Запись компонента для мержа его собственных `tokenDefinitions` в реестр тем.
 * Передаётся в `resolveThemes` в порядке `resolveSelection` (deps раньше зависящих).
 */
export interface ResolveThemesComponentEntry {
  providerId: string
  descriptor: Pick<GranularComponentDescriptor, 'name' | 'tokenDefinitions'>
}

const DEFAULT_SELECTOR = ':root'

/**
 * Мержит один вклад токенов (`tokenDef`) в реестр темы.
 *
 * Правила по селектору:
 *  - `selector` не задан → токены идут в ПЕРВИЧНЫЙ блок темы (или создают его
 *    с дефолтным `:root`, если тема ещё пуста). Так «безселекторный» вклад
 *    добавляется к уже существующему селектору темы, а не плодит `:root`.
 *  - `selector` задан явно → ищем/создаём блок с этим селектором. Разные
 *    селекторы одной темы дают отдельные CSS-блоки.
 *
 * Значения перезаписываются в порядке вызова (позже — важнее).
 */
function mergeIntoRegistry(
  registry: Record<string, ResolvedThemeTokens>,
  themeName: string,
  tokenDef: GranularThemeTokenSet,
): void {
  const entry = registry[themeName]

  if (!entry) {
    const selector = tokenDef.selector ?? DEFAULT_SELECTOR
    const block: ResolvedThemeSelectorBlock = { selector, tokens: { ...tokenDef.tokens } }
    registry[themeName] = { selector, tokens: block.tokens, blocks: [block] }
    return
  }

  if (tokenDef.selector === undefined) {
    Object.assign(entry.blocks[0].tokens, tokenDef.tokens)
    return
  }

  let block = entry.blocks.find(b => b.selector === tokenDef.selector)
  if (!block) {
    block = { selector: tokenDef.selector, tokens: {} }
    entry.blocks.push(block)
  }
  Object.assign(block.tokens, tokenDef.tokens)
}

/**
 * Для каждого провайдера — пересечение (`themes.names` ∪ дефолт) × `provider.theme`.
 * Если тема задана через tokenDefinitions — она имеет приоритет над themes[name].
 *
 * Если переданы `components`, их `tokenDefinitions` мержатся ПОСЛЕ провайдеров
 * (могут переопределять значения провайдера) — но только для тех тем, которые
 * активны (попали в `names`).
 */
export function resolveThemes(
  providers: readonly GranularProvider[],
  input: ResolveThemesInput = {},
  components: readonly ResolveThemesComponentEntry[] = [],
): ResolvedThemes {
  const { names, namesSource } = input.names === undefined
    ? resolveDefaultThemeNames(providers)
    : { names: input.names, namesSource: 'explicit' as const }

  const warnings = collectThemeWarnings(providers, names, namesSource)

  if (names.length === 0)
    return { names: [], items: [], tokenRegistry: {}, namesSource, warnings }

  const items: ResolvedThemeItem[] = []
  const tokenRegistry: Record<string, ResolvedThemeTokens> = {}

  for (const provider of providers) {
    const themeContrib = provider.theme
    if (!themeContrib)
      continue

    for (const themeName of names) {
      const tokenDef = themeContrib.tokenDefinitions?.[themeName]
      const cssUrl = themeContrib.themes?.[themeName]

      if (tokenDef) {
        items.push({ providerId: provider.id, themeName, tokenDefinition: tokenDef })
        mergeIntoRegistry(tokenRegistry, themeName, tokenDef)
      }
      else if (cssUrl) {
        items.push({ providerId: provider.id, themeName, cssUrl })
      }
    }
  }

  // Мерж токенов, опубликованных самими компонентами.
  // Выполняется ПОСЛЕ провайдеров — значит компонент может переопределить
  // значение провайдерского токена в рамках одной темы. Порядок `components`
  // соответствует post-order DFS из `resolveSelection` (deps раньше зависящих).
  const activeThemes = new Set(names)
  for (const { providerId, descriptor } of components) {
    const componentTokenDefs = descriptor.tokenDefinitions
    if (!componentTokenDefs)
      continue

    for (const themeName of Object.keys(componentTokenDefs)) {
      if (!activeThemes.has(themeName))
        continue

      const tokenDef = componentTokenDefs[themeName]
      if (!tokenDef)
        continue

      items.push({
        providerId,
        componentName: descriptor.name,
        themeName,
        tokenDefinition: tokenDef,
      })
      mergeIntoRegistry(tokenRegistry, themeName, tokenDef)
    }
  }

  return { names, items, tokenRegistry, namesSource, warnings }
}

/**
 * Имена тем, для которых у провайдера есть хоть какой-то вклад.
 *
 * Учитываются ОБА уровня: сам провайдер (`theme.themes` / `theme.tokenDefinitions`)
 * и его компоненты (`descriptor.tokenDefinitions`) — провайдер вправе не иметь
 * package-wide темы вовсе и отдавать токены только из компонентов. Считаем по
 * ОБЪЯВЛЕННЫМ компонентам, а не по выбранным: это проверка контракта пакета,
 * а не конкретной селекции приложения.
 */
function suppliedThemeNames(provider: GranularProvider): Set<string> {
  const names = new Set<string>()
  for (const name of Object.keys(provider.theme?.themes ?? {}))
    names.add(name)
  for (const name of Object.keys(provider.theme?.tokenDefinitions ?? {}))
    names.add(name)
  // Ссылки считаются источником наравне с литералами: node-слой развернёт их
  // до того, как дело дойдёт до эмита CSS. Иначе провайдер, отдающий тему
  // только через `tokenDefinitionsRef`, ложно попадал бы в
  // `default-theme-without-source`.
  for (const name of Object.keys(provider.theme?.tokenDefinitionsRef ?? {}))
    names.add(name)
  for (const component of provider.components) {
    for (const name of Object.keys(component.tokenDefinitions ?? {}))
      names.add(name)
    for (const name of Object.keys(component.tokenDefinitionsRef ?? {}))
      names.add(name)
  }
  return names
}

/**
 * Имена тем по умолчанию — объединение `theme.defaultThemes` всех провайдеров
 * в ПОРЯДКЕ ПРОВАЙДЕРОВ (топологическом: доноры раньше зависящих) с дедупом.
 * Порядок важен: он задаёт порядок блоков в итоговом CSS, а значит и каскад.
 *
 * Если поле не объявил никто — жёсткий фолбэк {@link GRANULAR_DEFAULT_THEME_NAMES}.
 */
function resolveDefaultThemeNames(
  providers: readonly GranularProvider[],
): { names: readonly string[], namesSource: ThemeNamesSource } {
  const names: string[] = []
  const seen = new Set<string>()

  for (const provider of providers) {
    for (const name of provider.theme?.defaultThemes ?? []) {
      if (typeof name !== 'string' || name.length === 0 || seen.has(name))
        continue
      seen.add(name)
      names.push(name)
    }
  }

  if (names.length === 0)
    return { names: GRANULAR_DEFAULT_THEME_NAMES, namesSource: 'fallback' }

  return { names, namesSource: 'provider-defaults' }
}

function collectThemeWarnings(
  providers: readonly GranularProvider[],
  names: readonly string[],
  namesSource: ThemeNamesSource,
): ResolvedThemeWarning[] {
  const warnings: ResolvedThemeWarning[] = []
  const supplied = new Map(providers.map(p => [p.id, suppliedThemeNames(p)]))

  // 1. Провайдер объявил тему дефолтной, но сам её не поставляет.
  for (const provider of providers) {
    for (const name of provider.theme?.defaultThemes ?? []) {
      if (!supplied.get(provider.id)!.has(name))
        warnings.push({ kind: 'default-theme-without-source', providerId: provider.id, theme: name })
    }
  }

  // 2. Тема покрыта не всеми провайдерами, которые вообще занимаются темами.
  //    «Занимается» = поставляет хоть одну тему (любую, не обязательно активную).
  //    Провайдер, который тем не касается вовсе (чистый поставщик компонентов
  //    или только base.css), не считается «отставшим».
  const themed = providers.filter(p => supplied.get(p.id)!.size > 0)
  if (themed.length > 1) {
    for (const name of names) {
      const without = themed.filter(p => !supplied.get(p.id)!.has(name)).map(p => p.id)
      if (without.length > 0 && without.length < themed.length)
        warnings.push({ kind: 'partial-theme', theme: name, providersWithout: without })
    }
  }

  // 3. Молча активированы несколько тем сразу.
  if (namesSource === 'provider-defaults' && names.length > 1)
    warnings.push({ kind: 'multiple-default-themes', themes: [...names] })

  return warnings
}
