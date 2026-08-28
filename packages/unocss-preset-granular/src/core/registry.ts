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

/** Разбивает квалифицированный ключ по ПОСЛЕДНЕМУ двоеточию: `a:b:C` — это провайдер `a:b`. */
export function splitComponentKey(key: string): [providerId: string, name: string] {
  const idx = key.lastIndexOf(':')
  return [key.slice(0, idx), key.slice(idx + 1)]
}

/**
 * Приводит пользовательский аргумент CLI к ключу реестра.
 *
 * Полная форма `providerId:Name` берётся как есть. Короткая `Name` (её в
 * `components` не принимают, но в CLI она — самый естественный ввод)
 * резолвится по реестру и разрешена, только если имя однозначно: иначе
 * пришлось бы молча выбрать один из одноимённых компонентов разных
 * провайдеров.
 *
 * Экспортируется ради `granular explain` и `granular tokens`: своя копия
 * правил разбора в каждой команде разъехалась бы с резолвером.
 */
export function resolveComponentTarget(
  input: string,
  registry: ComponentRegistry,
): { key: ComponentKey } | { ambiguous: string[] } {
  if (input.includes(':'))
    return { key: input as ComponentKey }

  const matches = [...registry.components.keys()].filter(k => splitComponentKey(k)[1] === input)
  if (matches.length === 1)
    return { key: matches[0] }
  return { ambiguous: matches }
}
