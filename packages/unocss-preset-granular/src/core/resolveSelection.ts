import type {
  GranularComponentDependency,
  GranularComponentDescriptor,
  GranularProvider,
} from '../contract'
import type { ComponentKey, ComponentRegistry, RegistryEntry } from './registry'
import { CircularDependencyError, ComponentNotFoundError, ProviderNotRegisteredError } from './errors'
import { toComponentKey } from './registry'

/**
 * Элемент выбора компонентов приложением.
 *
 * Строковая форма: квалифицированный ключ `'providerId:ComponentName'`.
 *   - Формат валидируется в runtime (`parseQualifiedKey`): требуется ровно
 *     один разделитель `:`, идентификатор провайдера и имя компонента по обе
 *     стороны от него.
 *   - Тип намеренно оставлен `string` (а не template-literal
 *     `` `${string}:${string}` ``): это избавляет от проблем расширения
 *     (`widening`) строковых литералов в массивах, объявленных без `as const`
 *     (например, `const opts = { components: ['pkg:Btn'] }`), и даёт
 *     корректную DX в конфигах приложений.
 *
 * Объектная форма удобна, когда из одного провайдера нужно подтянуть
 * несколько компонентов или все (`names: 'all'`).
 */
export type ComponentSelectionItem
  = | string
    | { provider: string, names: 'all' | readonly string[] }

export type ComponentSelection = 'all' | readonly ComponentSelectionItem[]

/** Нормализованное начальное множество компонентов (до транзитивного резолва). */
export function normalizeSelection(
  selection: ComponentSelection | undefined,
  registry: ComponentRegistry,
): ComponentKey[] {
  if (selection === undefined || selection === 'all') {
    // все компоненты всех провайдеров
    return [...registry.components.keys()]
  }

  const keys: ComponentKey[] = []

  for (const item of selection) {
    if (typeof item === 'string') {
      const key = parseQualifiedKey(item)
      keys.push(key)
      continue
    }

    const { provider, names } = item

    if (!registry.providers.has(provider))
      throw new ProviderNotRegisteredError(provider)

    if (names === 'all') {
      for (const descriptor of registry.getComponentsOfProvider(provider))
        keys.push(toComponentKey(provider, descriptor.name))
      continue
    }

    for (const name of names)
      keys.push(toComponentKey(provider, name))
  }

  return keys
}

function parseQualifiedKey(input: string): ComponentKey {
  const idx = input.lastIndexOf(':')
  if (idx <= 0 || idx === input.length - 1) {
    throw new Error(
      `Invalid component key '${input}': expected 'providerId:ComponentName' (short form 'Name' is only allowed inside a component's 'dependencies').`,
    )
  }
  return input as ComponentKey
}

/**
 * Нормализует запись зависимости в массив квалифицированных ключей.
 * `ownerProviderId` — провайдер компонента-владельца (для короткой формы 'Name').
 */
function normalizeDependency(
  dep: GranularComponentDependency,
  ownerProviderId: string,
): ComponentKey[] {
  if (typeof dep === 'string') {
    if (dep.includes(':'))
      return [dep as ComponentKey]
    return [toComponentKey(ownerProviderId, dep)]
  }

  return dep.components.map(name => toComponentKey(dep.provider, name))
}

export interface ResolvedComponents {
  /** Ключи компонентов в порядке post-order DFS (deps раньше зависящих). */
  readonly order: readonly ComponentKey[]
  /** Записи реестра, в том же порядке. */
  readonly entries: readonly RegistryEntry[]
  /** Уникальные провайдеры в порядке первого появления. */
  readonly providers: readonly GranularProvider[]
}

/**
 * Рекурсивно резолвит выбор компонентов вместе со всеми транзитивными зависимостями.
 * Проходит по графу `dependencies` в едином реестре; детектирует циклы;
 * выдаёт понятные ошибки про незарегистрированного провайдера и ненайденный компонент.
 */
export function resolveSelection(
  registry: ComponentRegistry,
  selection: ComponentSelection | undefined,
): ResolvedComponents {
  const order: ComponentKey[] = []
  const resolved = new Set<ComponentKey>()
  const resolving = new Set<ComponentKey>()
  const stack: string[] = []
  const providerOrder: GranularProvider[] = []
  const seenProviders = new Set<string>()

  const visit = (key: ComponentKey, referencedBy: string | undefined): void => {
    if (resolved.has(key))
      return

    if (resolving.has(key))
      throw new CircularDependencyError([...stack, key])

    const entry = registry.components.get(key)

    if (!entry) {
      const [providerId, componentName] = splitKey(key)
      if (!registry.providers.has(providerId))
        throw new ProviderNotRegisteredError(providerId, referencedBy)

      const available = registry.getComponentsOfProvider(providerId).map(d => d.name)
      throw new ComponentNotFoundError(providerId, componentName, available, referencedBy)
    }

    resolving.add(key)
    stack.push(key)

    for (const dep of entry.descriptor.dependencies ?? []) {
      for (const depKey of normalizeDependency(dep, entry.provider.id))
        visit(depKey, key)
    }

    stack.pop()
    resolving.delete(key)
    resolved.add(key)
    order.push(key)

    if (!seenProviders.has(entry.provider.id)) {
      seenProviders.add(entry.provider.id)
      providerOrder.push(entry.provider)
    }
  }

  const seeds = normalizeSelection(selection, registry)
  for (const key of seeds)
    visit(key, undefined)

  const entries = order.map(k => registry.components.get(k)!)

  return { order, entries, providers: providerOrder }
}

function splitKey(key: ComponentKey): [string, string] {
  const idx = key.lastIndexOf(':')
  return [key.slice(0, idx), key.slice(idx + 1)]
}

/** Union собственных safelist'ов всех посещённых компонентов. */
export function collectSafelist(entries: readonly RegistryEntry[]): string[] {
  const set = new Set<string>()
  for (const { descriptor } of entries) {
    for (const klass of descriptor.safelist ?? [])
      set.add(klass)
  }
  return [...set]
}

/** Union абсолютных URL/путей cssFiles всех компонентов (с сохранением порядка post-order). */
export function collectCssFiles(entries: readonly RegistryEntry[]): string[] {
  const set = new Set<string>()
  for (const { descriptor } of entries) {
    for (const file of descriptor.cssFiles ?? [])
      set.add(file)
  }
  return [...set]
}

/** Описание компонента по его позиции в `order` — удобно для FS-слоя. */
export function collectCssFilesDetailed(
  entries: readonly RegistryEntry[],
): Array<{ providerId: string, componentName: string, url: string, assetName?: string }> {
  const seen = new Set<string>()
  const result: Array<{ providerId: string, componentName: string, url: string, assetName?: string }> = []

  for (const { provider, descriptor } of entries) {
    const files = descriptor.cssFiles ?? []
    const assets = descriptor.cssFileAssetNames ?? []
    files.forEach((url, index) => {
      if (seen.has(url))
        return
      seen.add(url)
      result.push({
        providerId: provider.id,
        componentName: descriptor.name,
        url,
        assetName: assets[index],
      })
    })
  }

  return result
}

/** Утилита для внешнего доступа к списку дескрипторов. */
export function toDescriptors(entries: readonly RegistryEntry[]): readonly GranularComponentDescriptor[] {
  return entries.map(e => e.descriptor)
}
