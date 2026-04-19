import type { GranularComponentDescriptor, GranularProvider } from '../contract'
import { DuplicateProviderIdError } from './errors'

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
    if (providerMap.has(provider.id))
      throw new DuplicateProviderIdError(provider.id)

    providerMap.set(provider.id, provider)

    for (const descriptor of provider.components) {
      const key = toComponentKey(provider.id, descriptor.name)
      // Дубли внутри одного провайдера — берём последний, это ответственность провайдера.
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
