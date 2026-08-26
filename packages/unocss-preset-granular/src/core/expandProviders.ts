import type { GranularI18nContribution, GranularProvider } from '../contract'
import { GRANULAR_CONTRACT_VERSION } from '../contract'
import {
  CircularProviderDependencyError,
  DuplicateProviderIdError,
  InvalidProviderError,
  UnresolvedProviderDependencyError,
  UnsupportedContractVersionError,
} from './errors'
import { isValidExportName, localeExportName } from './i18nLocales'

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

  validateI18n(provider)
}

/**
 * Проверяет вклад строк.
 *
 * Все дефекты иначе всплывают у ПОТРЕБИТЕЛЯ и не в том пакете: пустой
 * `locales` оставляет генератору только агрегат — молча теряется tree-shaking
 * языков; кривой подпуть даёт `Failed to resolve import` на чужой сборке, где
 * причину будут искать в приложении; тег, из которого не выводится
 * идентификатор, ломает уже сам сгенерированный импорт.
 *
 * Существование подпути отсюда НЕ проверяется: это знание резолвера бандлера,
 * а не пресета, и ложное срабатывание было бы хуже пропуска.
 */
function validateI18n(provider: GranularProvider): void {
  const i18n = provider.i18n
  if (i18n === undefined)
    return

  if (typeof i18n !== 'object' || i18n === null || Array.isArray(i18n)) {
    throw new InvalidProviderError(
      provider.id,
      'invalid-i18n-contribution',
      `'i18n' must be an object with a 'locales' array (got ${JSON.stringify(i18n)}). `
      + `Omit the whole 'i18n' field if the package ships no strings.`,
    )
  }

  const entry = typeof i18n.entry === 'string' && i18n.entry.trim().length > 0
    ? i18n.entry.trim()
    : `${provider.id}/i18n`

  validateI18nSpecifiers(provider, i18n, entry)
  validateI18nLocales(provider, i18n, entry)
  validateI18nExportNames(provider, i18n, entry)
}

/** `entry` / `allEntry`: непустые спецификаторы без обрамляющих пробелов. */
function validateI18nSpecifiers(
  provider: GranularProvider,
  i18n: GranularI18nContribution,
  entry: string,
): void {
  for (const key of ['entry', 'allEntry'] as const) {
    const value = i18n[key]
    if (value === undefined)
      continue

    // Пробелы по краям отвергаются, а не тримятся: спецификатор уезжает в
    // манифест как есть, и `' pkg/i18n '` дал бы `' pkg/i18n /all'`.
    if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
      const fallback = key === 'entry' ? `${provider.id}/i18n` : `${entry}/all`
      throw new InvalidProviderError(
        provider.id,
        'invalid-i18n-entry',
        `'i18n.${key}' must be a non-empty module specifier without surrounding whitespace `
        + `(got ${JSON.stringify(value)}); omit it to use the default '${fallback}'.`,
      )
    }
  }
}

/** `locales`: непустой массив непустых тегов без повторов. */
function validateI18nLocales(
  provider: GranularProvider,
  i18n: GranularI18nContribution,
  entry: string,
): void {
  if (!Array.isArray(i18n.locales) || i18n.locales.length === 0) {
    throw new InvalidProviderError(
      provider.id,
      'invalid-i18n-locales',
      `'i18n.locales' must be a non-empty array of BCP 47 tags exported from '${entry}'. `
      + `Omit the whole 'i18n' field if the package ships no strings.`,
    )
  }

  const seen = new Set<string>()
  for (const locale of i18n.locales) {
    if (typeof locale !== 'string' || locale.trim().length === 0 || locale.trim() !== locale) {
      throw new InvalidProviderError(
        provider.id,
        'invalid-i18n-locales',
        `'i18n.locales' must contain non-empty BCP 47 tags without surrounding whitespace `
        + `(got ${JSON.stringify(locale)}) — each one is a top-level key of a collection in '${entry}'.`,
      )
    }

    // Сравнение без учёта регистра: теги BCP 47 регистронезависимы, и `RU`
    // рядом с `ru` — не два языка, а один импорт, посчитанный дважды.
    const key = locale.toLowerCase()
    if (seen.has(key)) {
      throw new InvalidProviderError(
        provider.id,
        'invalid-i18n-locales',
        `'i18n.locales' lists '${locale}' twice (tags are compared case-insensitively). `
        + `A repeated tag becomes a duplicate named import of one and the same collection.`,
      )
    }
    seen.add(key)
  }
}

/**
 * Имена экспортов: выводимые по конвенции — идентификаторы, объявленные
 * вручную — тоже, и только для тегов из `locales`.
 */
function validateI18nExportNames(
  provider: GranularProvider,
  i18n: GranularI18nContribution,
  entry: string,
): void {
  const overrides = i18n.exportNames

  if (overrides !== undefined) {
    if (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides)) {
      throw new InvalidProviderError(
        provider.id,
        'invalid-i18n-export-name',
        `'i18n.exportNames' must be an object mapping a tag from 'i18n.locales' to its export name `
        + `(got ${JSON.stringify(overrides)}).`,
      )
    }

    for (const [locale, name] of Object.entries(overrides)) {
      if (!i18n.locales.includes(locale)) {
        throw new InvalidProviderError(
          provider.id,
          'invalid-i18n-export-name',
          `'i18n.exportNames' declares '${locale}', which is not listed in 'i18n.locales'. `
          + `It is a sparse override over the tags, not a second list of them.`,
        )
      }

      if (typeof name !== 'string' || !isValidExportName(name)) {
        throw new InvalidProviderError(
          provider.id,
          'invalid-i18n-export-name',
          `'i18n.exportNames.${locale}' must be a valid identifier — it is written into `
          + `\`import { <name> } from '${entry}'\` (got ${JSON.stringify(name)}).`,
        )
      }
    }
  }

  for (const locale of i18n.locales) {
    if (overrides?.[locale] !== undefined)
      continue

    const derived = localeExportName(locale)
    if (!isValidExportName(derived)) {
      throw new InvalidProviderError(
        provider.id,
        'invalid-i18n-export-name',
        `'${locale}' yields '${derived}', which is not a valid identifier, so no named import `
        + `can be generated from '${entry}'. Declare the real export name in 'i18n.exportNames'.`,
      )
    }
  }
}
