import type { GranularProvider } from '../contract'
import {
  CircularProviderDependencyError,
  DuplicateProviderIdError,
  UnresolvedProviderDependencyError,
} from './errors'

/**
 * Рекурсивно разворачивает `roots` + транзитивный граф `provider.dependencies`
 * в плоский, дедуплицированный и топологически упорядоченный массив провайдеров
 * (зависимости всегда раньше тех, кто от них зависит).
 *
 * Правила:
 * - Дедупликация — по `provider.id`. Если в графе встречаются два РАЗНЫХ
 *   инстанса с одинаковым `id`, бросается `DuplicateProviderIdError` с
 *   путём, по которому дубль был обнаружен. Повторная встреча того же самого
 *   инстанса (diamond‑граф) — корректный сценарий, ошибкой не считается.
 * - Циклы в `dependencies` — ошибка `CircularProviderDependencyError` с
 *   полной цепочкой.
 * - Строковые зависимости (`dependencies: ['providerId']`) — мягкие:
 *   они не тянут провайдер в граф сами по себе, а лишь требуют, чтобы
 *   к концу резолва соответствующий `id` уже присутствовал в реестре
 *   (через `roots[]` или объектные `dependencies`). Иначе —
 *   `UnresolvedProviderDependencyError`.
 */
export function expandProviders(
  roots: readonly GranularProvider[],
): GranularProvider[] {
  const byId = new Map<string, GranularProvider>()
  const order: GranularProvider[] = []
  const onStack = new Set<string>()
  const pendingStrings: { id: string, from: string }[] = []

  const visit = (provider: GranularProvider, path: readonly string[]): void => {
    const existing = byId.get(provider.id)
    if (existing) {
      if (existing !== provider)
        throw new DuplicateProviderIdError(provider.id, [...path, provider.id])
      return
    }
    if (onStack.has(provider.id))
      throw new CircularProviderDependencyError([...path, provider.id])

    onStack.add(provider.id)

    for (const dep of provider.dependencies ?? []) {
      if (typeof dep === 'string') {
        pendingStrings.push({ id: dep, from: provider.id })
        continue
      }
      visit(dep, [...path, provider.id])
    }

    onStack.delete(provider.id)
    byId.set(provider.id, provider)
    order.push(provider)
  }

  for (const root of roots)
    visit(root, [])

  for (const { id, from } of pendingStrings) {
    if (!byId.has(id))
      throw new UnresolvedProviderDependencyError(id, from)
  }

  return order
}
