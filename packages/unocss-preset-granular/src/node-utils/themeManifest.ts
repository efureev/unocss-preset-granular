import type { PresetGranularNodeOptions } from '../preset.node'
import type { GranularThemeActivation, GranularThemeEntry, GranularThemeManifest } from '../runtime/manifest'

import { collectTokenLayers } from '../core/tokenLayers'
import { resolveGranularNode } from '../preset.node'
import { resolveThemeActivation } from '../runtime/manifest'

export interface GranularThemeManifestOptions {
  /**
   * Класть ли в манифест значения токенов (по селекторам).
   *
   * По умолчанию `false`: для переключения тем они не нужны — токены уже в
   * CSS, — а в клиентский бандл уехал бы весь набор значений. Включайте, если
   * значения нужны самому приложению (превью палитры, canvas, инлайн-стили).
   */
  includeTokens?: boolean
  /**
   * Явная активация для тем, у которых сборка не может вывести селектор:
   * `{ dark: { type: 'class', value: 'dark' } }`.
   *
   * Нужно, когда провайдер отдаёт тему готовым CSS-файлом (`theme.themes[name]`):
   * пресет инлайнит файл как есть и не знает, какие селекторы внутри.
   */
  activations?: Readonly<Record<string, GranularThemeActivation>>
}

/**
 * Строит манифест тем — то, что рантайму нужно знать о темах сборки.
 *
 * Источник — ТА ЖЕ резолюция, из которой node-слой эмитит CSS
 * (`resolveGranularNode` — мемоизирована по идентичности `options` и разворачивает
 * `tokenDefinitionsRef`), поэтому
 * манифест не может разъехаться с содержимым стилей: имена тем и селекторы
 * берутся из одного места.
 *
 * ```ts
 * // vite.config.ts — если не хочется плагина
 * const manifest = getGranularThemeManifest(granularOptions)
 * define: { __THEMES__: JSON.stringify(manifest) }
 * ```
 */
export function getGranularThemeManifest(
  options: PresetGranularNodeOptions,
  manifestOptions: GranularThemeManifestOptions = {},
): GranularThemeManifest {
  const { themes } = resolveGranularNode(options)
  const overrides = manifestOptions.activations ?? {}

  // Значения — из общей раскладки слоёв, а не из `tokenRegistry`: последний не
  // содержит `themes.tokenOverrides`, и манифест с `includeTokens` отдавал бы
  // до-override значения, разъезжаясь с эмитируемым CSS при совпадающих
  // селекторах.
  // Считается ВСЕГДА, а не только под `includeTokens`: из этой же раскладки
  // берутся СЕЛЕКТОРЫ. Вложенная форма `tokenOverrides` создаёт блок под новым
  // селектором, и он попадает в эмитируемый CSS — манифест, читающий селекторы
  // из `tokenRegistry`, о таком блоке не знал бы, и переключатель тем не смог
  // бы активировать то, что в стилях есть.
  const tokenLayers = collectTokenLayers(themes, options.themes?.tokenOverrides, {
    strictTokens: options.themes?.strictTokens,
  })

  const entries: GranularThemeEntry[] = themes.names.map((name) => {
    const registry = themes.tokenRegistry[name]
    const blocks = tokenLayers.get(name)
    const selectors = blocks?.length
      ? blocks.map(block => block.selector)
      : registry?.blocks.map(block => block.selector) ?? []
    const activation = overrides[name] ?? resolveThemeActivation(selectors)

    // Метаданные берутся из ТОЙ ЖЕ резолюции, что и селекторы, — не из
    // `options.themes.define` напрямую: только резолюция знает, какие темы
    // реально активны после `names`/прунинга базовых.
    const meta = themes.meta[name]

    const entry: GranularThemeEntry = {
      name,
      selectors,
      activation,
      ...(meta?.label !== undefined ? { label: meta.label } : {}),
      ...(meta?.colorScheme !== undefined ? { colorScheme: meta.colorScheme } : {}),
    }

    // Без `&& registry`: тему, собранную одними лишь `tokenOverrides`, реестр
    // не содержит, а CSS для неё эмитится — значения обязаны попасть в манифест.
    if (manifestOptions.includeTokens) {
      entry.tokens = Object.fromEntries(
        (blocks ?? []).map(block => [
          block.selector,
          Object.fromEntries(
            [...block.tokens.values()]
              .filter(chain => chain.effective !== undefined)
              .map(chain => [chain.token, chain.effective!]),
          ),
        ]),
      )
    }

    return entry
  })

  return {
    themes: entries,
    defaultTheme: entries[0]?.name ?? '',
  }
}

/** Виртуальный модуль, который отдаёт плагин {@link granularThemesPlugin}. */
export const GRANULAR_THEMES_MODULE_ID = 'virtual:granular-themes'
const RESOLVED_ID = `\0${GRANULAR_THEMES_MODULE_ID}`

/**
 * Структурный тип Vite-плагина — чтобы не тянуть `vite` в зависимости пакета.
 * Совместим с `PluginOption` по форме.
 */
export interface GranularVitePlugin {
  name: string
  enforce?: 'pre' | 'post'
  resolveId: (id: string) => string | undefined
  load: (id: string) => string | undefined
}

/**
 * Vite-плагин: отдаёт манифест тем как модуль `virtual:granular-themes`.
 *
 * ```ts
 * // vite.config.ts
 * plugins: [vue(), UnoCSS(), granularThemesPlugin(granularOptions)]
 * ```
 * ```ts
 * // main.ts
 * import manifest from 'virtual:granular-themes'
 * ```
 *
 * Манифест считается один раз на старте конфига; правка `uno.config.ts`
 * перезапускает dev-сервер Vite, так что отдельная инвалидация не нужна.
 */
export function granularThemesPlugin(
  options: PresetGranularNodeOptions,
  manifestOptions: GranularThemeManifestOptions = {},
): GranularVitePlugin {
  return {
    name: 'granular:themes',
    enforce: 'pre',

    resolveId(id) {
      return id === GRANULAR_THEMES_MODULE_ID ? RESOLVED_ID : undefined
    },

    load(id) {
      if (id !== RESOLVED_ID)
        return undefined
      const manifest = getGranularThemeManifest(options, manifestOptions)
      return `export default ${JSON.stringify(manifest)}\n`
    },
  }
}
