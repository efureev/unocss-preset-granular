import type { GranularProvider } from '../contract'
import { GRANULAR_CONTRACT_VERSION } from '../contract'
import {
  CircularProviderDependencyError,
  DuplicateProviderIdError,
  InvalidProviderError,
  UnresolvedProviderDependencyError,
  UnsupportedContractVersionError,
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

    if (provider.contractVersion !== GRANULAR_CONTRACT_VERSION) {
      throw new UnsupportedContractVersionError(
        provider.id,
        provider.contractVersion,
        GRANULAR_CONTRACT_VERSION,
      )
    }

    validateProvider(provider)

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

/**
 * Проверяет то, на чём молча ломался FS-слой:
 *
 *   - `id` — часть ключа `providerId:Name`, пустой делает ключи неразличимыми;
 *   - `packageBaseUrl` — база для `new URL(...)`; без завершающего `/`
 *     последний сегмент отбрасывается, и скан уезжает на уровень выше
 *     (`file:///pkg/dist` + `components/X/` → `file:///pkg/components/X/`);
 *   - `cssFiles`/`cssFileAssetNames` сопоставляются ПОЗИЦИОННО, рассинхрон
 *     длин молча отключает fallback чтения CSS для «хвоста».
 *
 * Всё это раньше всплывало поздно и невнятно: `console.warn` о пропущенном
 * компоненте либо `ERR_INVALID_URL_SCHEME` из `fileURLToPath`.
 */
function validateProvider(provider: GranularProvider): void {
  if (typeof provider.id !== 'string' || provider.id.trim().length === 0) {
    throw new InvalidProviderError(
      String(provider.id),
      'invalid-id',
      `'id' must be a non-empty string — it is used as the 'providerId:ComponentName' key prefix.`,
    )
  }

  const baseUrl = provider.packageBaseUrl
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  }
  catch {
    throw new InvalidProviderError(
      provider.id,
      'invalid-package-base-url',
      `'packageBaseUrl' must be an absolute URL (got ${JSON.stringify(baseUrl)}). `
      + `Use resolvePackageBaseUrl(import.meta.url) from '@feugene/unocss-preset-granular/contract'.`,
    )
  }

  if (!parsed.pathname.endsWith('/')) {
    throw new InvalidProviderError(
      provider.id,
      'package-base-url-not-a-directory',
      `'packageBaseUrl' must point to a DIRECTORY and end with '/' (got ${JSON.stringify(baseUrl)}); `
      + `otherwise every relative resolution silently drops its last segment.`,
    )
  }

  if (!Array.isArray(provider.components)) {
    throw new InvalidProviderError(
      provider.id,
      'invalid-components',
      `'components' must be an array (got ${typeof provider.components}).`,
    )
  }

  for (const descriptor of provider.components) {
    const files = descriptor.cssFiles ?? []
    const assets = descriptor.cssFileAssetNames ?? []
    if (assets.length > 0 && assets.length !== files.length) {
      throw new InvalidProviderError(
        provider.id,
        'css-files-length-mismatch',
        `'cssFiles' (${files.length}) and 'cssFileAssetNames' (${assets.length}) are matched by position, `
        + `so their lengths must be equal — otherwise the read fallback is silently disabled for the extra entries.`,
        descriptor.name,
      )
    }
  }
}
