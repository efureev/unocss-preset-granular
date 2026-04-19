import type { GranularProvider, GranularThemeTokenSet } from '../contract'

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
}

export interface ResolvedThemes {
  names: readonly string[]
  items: ResolvedThemeItem[]
  /** Слитый реестр токенов по темам: themeName -> { selector, tokens } */
  tokenRegistry: Record<string, GranularThemeTokenSet>
}

/**
 * Для каждого провайдера — пересечение (`themes.names` ∪ дефолт) × `provider.theme`.
 * Если тема задана через tokenDefinitions — она имеет приоритет над themes[name].
 */
export function resolveThemes(
  providers: readonly GranularProvider[],
  input: ResolveThemesInput = {},
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
        } else {
          // Селектор берется от первого провайдера, если не задан явно
          if (!tokenRegistry[themeName].selector) {
            tokenRegistry[themeName].selector = tokenDef.selector
          }
          tokenRegistry[themeName].tokens = {
            ...tokenRegistry[themeName].tokens,
            ...tokenDef.tokens,
          }
        }
      } else if (cssUrl) {
        items.push({ providerId: provider.id, themeName, cssUrl })
      }
    }
  }

  return { names, items, tokenRegistry }
}
