import type { PresetGranularNodeOptions } from '../preset.node'
import type { GranularI18nBinding, GranularI18nEntry, GranularI18nManifest } from '../runtime/i18nManifest'
import type { GranularVitePlugin } from './themeManifest'

import { localeExportName, matchLocale } from '../core/i18nLocales'
import { resolveGranularNode } from '../preset.node'

export interface GranularI18nManifestOptions {
  /**
   * Языки, которые нужны приложению. Пусто — берутся все объявленные.
   *
   * Подбор считается здесь, а не у потребителя, потому что правило нетривиально
   * (`ru-RU` обслуживается лоадерами `ru`, а `pt-BR` импортируется как `ptBR`).
   * Продублированное в каждом потребителе, оно разъедется.
   */
  locales?: readonly string[]
  /**
   * Оставлять только провайдеров, чьи компоненты реально попали в сборку.
   *
   * По умолчанию `false`. Причина: строки нужны не только компонентам —
   * приложение вправе взять словарь пакета для своего текста. Включайте, когда
   * важен размер и точно известно, что чужие строки не используются.
   *
   * Пакета БЕЗ компонентов фильтр не касается: попасть в сборку через
   * компоненты он не может по построению, и строки — единственное, что он
   * отдаёт. Отфильтровать его значило бы выбросить весь его смысл.
   */
  onlySelected?: boolean
}

/** Связка на этапе сборки: `serves` ещё дописывается. */
interface MutableBinding extends Omit<GranularI18nBinding, 'serves'> {
  serves: string[]
}

/**
 * Строит манифест строк из ТОЙ ЖЕ резолюции, из которой node-слой эмитит CSS.
 *
 * Поэтому манифест не может разъехаться со сборкой: список пакетов у них один.
 *
 * ```ts
 * // astro.config.mjs / vite.config.ts
 * const manifest = getGranularI18nManifest(granularOptions, { locales: ['en', 'ru'] })
 * ```
 */
export function getGranularI18nManifest(
  options: PresetGranularNodeOptions,
  manifestOptions: GranularI18nManifestOptions = {},
): GranularI18nManifest {
  const { providers, resolved } = resolveGranularNode(options)
  const requested = manifestOptions.locales ?? []

  const contributing = manifestOptions.onlySelected
    ? new Set(resolved.entries.map(entry => entry.provider.id))
    : null

  const entries: GranularI18nEntry[] = []
  const served = new Set<string>()

  for (const provider of providers) {
    const i18n = provider.i18n
    if (!i18n)
      continue
    if (contributing && provider.components.length > 0 && !contributing.has(provider.id))
      continue

    const entry = i18n.entry ?? `${provider.id}/i18n`
    const declared = [...i18n.locales]
    const overrides = i18n.exportNames ?? {}
    const exportNameFor = (locale: string): string => overrides[locale] ?? localeExportName(locale)

    // Связки схлопываются по объявленному тегу: `ru` и `ru-RU`, запрошенные
    // разом, покрываются одним импортом `ru`, а не двумя одинаковыми.
    const byLocale = new Map<string, MutableBinding>()

    if (requested.length === 0) {
      for (const locale of declared) {
        byLocale.set(locale, { locale, exportName: exportNameFor(locale), serves: [locale], via: 'exact' })
      }
    }
    else {
      for (const want of requested) {
        const match = matchLocale(declared, want)
        if (!match)
          continue

        served.add(want)
        warnAmbiguousRegion(provider.id, want, match.locale, match.alternatives)

        const existing = byLocale.get(match.locale)
        if (existing) {
          if (!existing.serves.includes(want))
            existing.serves.push(want)
          continue
        }

        byLocale.set(match.locale, {
          locale: match.locale,
          exportName: exportNameFor(match.locale),
          serves: [want],
          via: match.via,
        })
      }
    }

    entries.push({
      providerId: provider.id,
      entry,
      allEntry: i18n.allEntry ?? `${entry}/all`,
      locales: declared,
      bindings: [...byLocale.values()],
    })
  }

  const seenLocales = new Set<string>()
  const locales: string[] = []
  for (const entry of entries) {
    for (const binding of entry.bindings) {
      if (seenLocales.has(binding.locale))
        continue
      seenLocales.add(binding.locale)
      locales.push(binding.locale)
    }
  }

  const seenUnserved = new Set<string>()
  const unserved = requested.filter((want) => {
    if (served.has(want) || seenUnserved.has(want))
      return false
    seenUnserved.add(want)
    return true
  })

  return { entries, locales, unserved }
}

/**
 * Обратный шаг с несколькими кандидатами: `ru` при объявленных `ru-RU`, `ru-BY`.
 *
 * Выбирается первый в порядке объявления — так же поступает `negotiateLocale`.
 * Но у него выбор происходит в рантайме и обратим, а здесь решается, что уедет
 * в бандл: промолчать значит зафиксировать произвольный регион навсегда.
 */
function warnAmbiguousRegion(
  providerId: string,
  requested: string,
  chosen: string,
  alternatives: readonly string[],
): void {
  if (alternatives.length === 0)
    return

  console.warn(
    `[granular] i18n: '${providerId}' has no '${requested}' locale; picked regional variant `
    + `'${chosen}' over ${alternatives.map(name => `'${name}'`).join(', ')}. `
    + `Request the exact tag to make the choice explicit.`,
  )
}

/** Виртуальный модуль, который отдаёт плагин {@link granularI18nPlugin}. */
export const GRANULAR_I18N_MODULE_ID = 'virtual:granular-i18n'
const RESOLVED_ID = `\0${GRANULAR_I18N_MODULE_ID}`

/**
 * Vite-плагин: отдаёт манифест строк как модуль `virtual:granular-i18n`.
 *
 * ```ts
 * // vite.config.ts
 * plugins: [vue(), UnoCSS(), granularI18nPlugin(granularOptions, { locales: ['en', 'ru'] })]
 * ```
 * ```ts
 * // main.ts
 * import manifest from 'virtual:granular-i18n'
 * ```
 *
 * Отдаются **данные**, а не готовые импорты лоадеров: сгенерировать
 * `import { en } from '<pkg>/i18n'` может только тот, кто знает, каким
 * бандлером и в каком окружении это будет собрано. Пресет фреймворк-агностичен
 * и таким знанием не располагает.
 *
 * Манифест считается один раз на старте конфига; правка `uno.config.ts`
 * перезапускает dev-сервер Vite, так что отдельная инвалидация не нужна.
 */
export function granularI18nPlugin(
  options: PresetGranularNodeOptions,
  manifestOptions: GranularI18nManifestOptions = {},
): GranularVitePlugin {
  return {
    name: 'granular:i18n',
    enforce: 'pre',

    resolveId(id) {
      return id === GRANULAR_I18N_MODULE_ID ? RESOLVED_ID : undefined
    },

    load(id) {
      if (id !== RESOLVED_ID)
        return undefined
      const manifest = getGranularI18nManifest(options, manifestOptions)
      return `export default ${JSON.stringify(manifest)}\n`
    },
  }
}
