import type { Preflight, Preset, Rule, Variant } from '@unocss/core'

import type { GranularProvider } from './contract'
import type { ComponentSelection, ResolvedComponents } from './core/resolveSelection'
import type { ResolvedThemes, ResolveThemesInput } from './core/resolveThemes'
import { uniqueRef } from './core/dedupe'
import { expandProviders } from './core/expandProviders'
import { applyLayerToAll } from './core/layer'
import { buildRegistry } from './core/registry'
import {
  collectCssFilesDetailed,
  collectSafelist,

  resolveSelection,
} from './core/resolveSelection'
import { resolveThemes } from './core/resolveThemes'

export interface ThemesOptions extends ResolveThemesInput {
  /**
   * Переопределение CSS-файла темы.
   * Ключ — имя темы (как в `names`), значение — либо один путь (применится
   * ко всем провайдерам, у кого эта тема есть), либо объект per providerId.
   */
  themeFiles?: Partial<Record<string, string | Partial<Record<string, string>>>>

  /**
   * Точечный override токенов конкретной темы.
   * Значение перебивает токены провайдеров/компонентов, экспортирующих
   * `tokenDefinitions`.
   *
   * Поддерживаются две формы записи значения темы:
   *   1. Плоская `{ token: value }` — токены пишутся в ПЕРВИЧНЫЙ (первый)
   *      селектор темы (обычно `:root`). Если у темы ещё нет ни одного блока —
   *      создаётся блок `:root`.
   *   2. Вложенная `{ selector: { token: value } }` — токены пишутся под
   *      указанный селектор (создаётся при необходимости). Позволяет целиться
   *      в конкретный блок мультиселекторной темы (напр. `.dark`).
   *
   * Различение — по типу значения: строка ⇒ плоская форма, объект ⇒ вложенная.
   */
  tokenOverrides?: Partial<Record<string, Readonly<Record<string, string | Readonly<Record<string, string>>>>>>

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
 * Кэш резолюции по идентичности объекта `options`. Приложение обычно передаёт
 * ОДИН и тот же объект опций и в `presetGranularNode`, и в `granularContent`
 * (и во внутренние резолверы), поэтому мемоизация по ссылке избавляет от
 * 3–4-кратного пересчёта одного и того же графа за один конфиг.
 *
 * Предполагается, что `options` не мутируется после первого резолва.
 */
const resolutionCache = new WeakMap<PresetGranularOptions, PresetGranularResolution>()

/**
 * Вычисляет всё, что нужно для сборки пресета, один раз.
 * Используется и browser-, и node-вариантами. Результат мемоизируется по
 * ссылке на `options`.
 */
export function resolvePresetGranular(
  options: PresetGranularOptions,
): PresetGranularResolution {
  const cached = resolutionCache.get(options)
  if (cached)
    return cached

  const providers = expandProviders(options.providers)
  const registry = buildRegistry(providers)
  const resolved = resolveSelection(registry, options.components)
  const safelist = collectSafelist(resolved.entries)
  const cssFiles = collectCssFilesDetailed(resolved.entries)
  const themes = resolveThemes(
    providers,
    options.themes,
    resolved.entries.map(e => ({ providerId: e.provider.id, descriptor: e.descriptor })),
  )

  const result: PresetGranularResolution = {
    resolved,
    themes,
    cssFiles,
    safelist,
    providers,
  }
  resolutionCache.set(options, result)
  return result
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
      if (contrib.rules)
        rules.push(...contrib.rules)
      if (contrib.variants)
        variants.push(...contrib.variants)
      if (contrib.preflights)
        providerPreflights.push(...contrib.preflights)
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
