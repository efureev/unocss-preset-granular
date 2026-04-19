import type { Preflight, Preset, Rule, Variant } from '@unocss/core'

import type { GranularProvider } from './contract'
import { applyLayerToAll } from './core/layer'
import { uniqueRef } from './core/dedupe'
import { expandProviders } from './core/expandProviders'
import { buildRegistry } from './core/registry'
import {
  collectCssFilesDetailed,
  collectSafelist,
  resolveSelection,
  type ComponentSelection,
  type ResolvedComponents,
} from './core/resolveSelection'
import { resolveThemes, type ResolveThemesInput, type ResolvedThemes } from './core/resolveThemes'

export interface ThemesOptions extends ResolveThemesInput {
  /**
   * Переопределение CSS-файла темы.
   * Ключ — имя темы (как в `names`), значение — либо один путь (применится
   * ко всем провайдерам, у кого эта тема есть), либо объект per providerId.
   */
  themeFiles?: Partial<Record<string, string | Partial<Record<string, string>>>>

  /**
   * Точечный override токенов конкретной темы.
   * Значение перебивает токены провайдеров, экспортирующих `tokenDefinitions`.
   */
  tokenOverrides?: Partial<Record<string, Readonly<Record<string, string>>>>

  /**
   * Если `true`, запрещает override токенов, которых нет ни в одном провайдере.
   * По умолчанию — `false` (lenient mode).
   */
  strictTokens?: boolean

  /** Переопределить base.css (глобально или по providerId). */
  baseFile?: string | Partial<Record<string, string>>
  /** Переопределить tokens.css (глобально или по providerId). */
  tokensFile?: string | Partial<Record<string, string>>
}

export interface PresetGranularOptions {
  providers: readonly GranularProvider[]
  components?: ComponentSelection
  themes?: ThemesOptions
  layer?: string
  /** Дополнительные preflights приложения (будут после остальных). */
  preflights?: readonly Preflight[]
  /** Подключать ли rules/variants/preflights от провайдеров (default: true). */
  includeProviderUnocss?: boolean
}

/**
 * Внутренний срез, который browser-preset возвращает в дополнение к собственно
 * `Preset`-объекту — используется node-слоем, чтобы не пересчитывать дважды.
 */
export interface PresetGranularResolution {
  readonly resolved: ResolvedComponents
  readonly themes: ResolvedThemes
  readonly cssFiles: ReturnType<typeof collectCssFilesDetailed>
  readonly safelist: readonly string[]
  /**
   * Плоский, дедуплицированный и топологически упорядоченный список провайдеров
   * (`options.providers` + их транзитивные `provider.dependencies`). Именно его
   * используют внутренние резолверы; node‑слой обязан опираться на этот массив,
   * чтобы инлайнить темы/base/tokens и от транзитивных доноров тоже.
   */
  readonly providers: readonly GranularProvider[]
}

/**
 * Вычисляет всё, что нужно для сборки пресета, один раз.
 * Используется и browser-, и node-вариантами.
 */
export function resolvePresetGranular(
  options: PresetGranularOptions,
): PresetGranularResolution {
  const providers = expandProviders(options.providers)
  const registry = buildRegistry(providers)
  const resolved = resolveSelection(registry, options.components)
  const safelist = collectSafelist(resolved.entries)
  const cssFiles = collectCssFilesDetailed(resolved.entries)
  const themes = resolveThemes(providers, options.themes)

  return {
    resolved,
    themes,
    cssFiles,
    safelist,
    providers,
  }
}

/**
 * Browser-вариант пресета. Не читает файлы — любые CSS-preflights должен
 * предоставить провайдер (через `GranularUnocssContribution.preflights`)
 * или приложение (через `options.preflights`).
 */
export function presetGranular(options: PresetGranularOptions): Preset {
  const { resolved, safelist } = resolvePresetGranular(options)
  const includeProviderUnocss = options.includeProviderUnocss !== false

  const rules: Rule[] = []
  const variants: Variant[] = []
  const providerPreflights: Preflight[] = []

  if (includeProviderUnocss) {
    for (const provider of resolved.providers) {
      const contrib = provider.unocss
      if (!contrib)
        continue
      if (contrib.rules) rules.push(...contrib.rules)
      if (contrib.variants) variants.push(...contrib.variants)
      if (contrib.preflights) providerPreflights.push(...contrib.preflights)
    }
  }

  const preflights = applyLayerToAll(
    [...providerPreflights, ...(options.preflights ?? [])],
    options.layer,
  )

  return {
    name: 'granular-preset',
    layer: options.layer,
    safelist: [...safelist],
    preflights,
    rules: uniqueRef(rules),
    variants: uniqueRef(variants),
  }
}
