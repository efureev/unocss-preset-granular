import type { GranularComponentDescriptor, GranularProvider, GranularThemeTokenSet } from '../contract'

/** Жёсткий дефолт ядра пресета: если `names` не передан — грузим только `light`. */
export const GRANULAR_DEFAULT_THEME_NAMES = ['light'] as const

export interface ResolveThemesInput {
  /** Если undefined — применяется дефолт `['light']`. Пустой массив — без тем. */
  names?: readonly string[]
}

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
  const names: readonly string[] = input.names === undefined
    ? GRANULAR_DEFAULT_THEME_NAMES
    : input.names

  if (names.length === 0)
    return { names: [], items: [], tokenRegistry: {} }

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

  return { names, items, tokenRegistry }
}
