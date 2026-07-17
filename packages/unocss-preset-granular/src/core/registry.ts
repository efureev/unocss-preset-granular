import type { GranularComponentDescriptor, GranularProvider } from '../contract'
import { DuplicateComponentNameError, DuplicateProviderIdError } from './errors'

/** Плоский ключ компонента: `"providerId:Name"`. */
export type ComponentKey = `${string}:${string}`

export interface RegistryEntry {
  provider: GranularProvider
  descriptor: GranularComponentDescriptor
}

export interface ComponentRegistry {
  readonly providers: ReadonlyMap<string, GranularProvider>
  readonly components: ReadonlyMap<ComponentKey, RegistryEntry>
  getComponentsOfProvider: (providerId: string) => readonly GranularComponentDescriptor[]
}

export function toComponentKey(providerId: string, name: string): ComponentKey {
  return `${providerId}:${name}` as ComponentKey
}

/** Строит единый реестр компонентов со всех провайдеров. */
export function buildRegistry(
  providers: readonly GranularProvider[],
): ComponentRegistry {
  const providerMap = new Map<string, GranularProvider>()
  const componentMap = new Map<ComponentKey, RegistryEntry>()

  for (const provider of providers) {
    // Каноническая дедупликация провайдеров живёт в `expandProviders` (по id и
    // по конфликтующим инстансам). Сюда `buildRegistry` получает уже
    // развёрнутый и дедуплицированный список, поэтому проверка ниже — дешёвый
    // invariant-guard на случай прямого вызова `buildRegistry` в обход
    // `expandProviders` (например, из тестов), а не основная линия защиты.
    if (providerMap.has(provider.id))
      throw new DuplicateProviderIdError(provider.id)

    providerMap.set(provider.id, provider)

    const namesInProvider = new Set<string>()
    for (const descriptor of provider.components) {
      // Имена компонентов уникальны В ПРЕДЕЛАХ провайдера — дубликат это баг
      // публикации, ловим его сразу (fail-fast), а не «берём последний».
      if (namesInProvider.has(descriptor.name))
        throw new DuplicateComponentNameError(provider.id, descriptor.name)
      namesInProvider.add(descriptor.name)

      const key = toComponentKey(provider.id, descriptor.name)
      componentMap.set(key, { provider, descriptor })
    }
  }

  return {
    providers: providerMap,
    components: componentMap,
    getComponentsOfProvider(providerId) {
      const provider = providerMap.get(providerId)
      return provider ? provider.components : []
    },
  }
}
