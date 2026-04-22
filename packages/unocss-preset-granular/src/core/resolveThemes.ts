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

export interface ResolvedThemes {
  names: readonly string[]
  items: ResolvedThemeItem[]
  /** Слитый реестр токенов по темам: themeName -> { selector, tokens } */
  tokenRegistry: Record<string, GranularThemeTokenSet>
}

/**
 * Запись компонента для мержа его собственных `tokenDefinitions` в реестр тем.
 * Передаётся в `resolveThemes` в порядке `resolveSelection` (deps раньше зависящих).
 */
export interface ResolveThemesComponentEntry {
  providerId: string
  descriptor: Pick<GranularComponentDescriptor, 'name' | 'tokenDefinitions'>
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
  const tokenRegistry: Record<string, GranularThemeTokenSet> = {}

  for (const provider of providers) {
    const themeContrib = provider.theme
    if (!themeContrib)
      continue

    for (const themeName of names) {
      const tokenDef = themeContrib.tokenDefinitions?.[themeName]
      const cssUrl = themeContrib.themes?.[themeName]

      if (tokenDef) {
        items.push({ providerId: provider.id, themeName, tokenDefinition: tokenDef })

        // Мержим в реестр
        if (!tokenRegistry[themeName]) {
          tokenRegistry[themeName] = {
            selector: tokenDef.selector,
            tokens: { ...tokenDef.tokens },
          }
        }
        else {
          // Селектор берется от первого провайдера, если не задан явно
          if (!tokenRegistry[themeName].selector) {
            tokenRegistry[themeName].selector = tokenDef.selector
          }
          tokenRegistry[themeName].tokens = {
            ...tokenRegistry[themeName].tokens,
            ...tokenDef.tokens,
          }
        }
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

      if (!tokenRegistry[themeName]) {
        tokenRegistry[themeName] = {
          selector: tokenDef.selector,
          tokens: { ...tokenDef.tokens },
        }
      }
      else {
        if (!tokenRegistry[themeName].selector && tokenDef.selector)
          tokenRegistry[themeName].selector = tokenDef.selector
        tokenRegistry[themeName].tokens = {
          ...tokenRegistry[themeName].tokens,
          ...tokenDef.tokens,
        }
      }
    }
  }

  return { names, items, tokenRegistry }
}
