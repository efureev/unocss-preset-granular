import type { Preflight, Preset, Rule, Variant } from '@unocss/core'

import type { GranularProvider } from './contract'
import type { ComponentSelection, ResolvedComponents } from './core/resolveSelection'
import type { ResolvedThemes, ResolveThemesInput } from './core/resolveThemes'
import { createDebug } from './core/debug'
import { uniqueRef } from './core/dedupe'
import { expandProviders } from './core/expandProviders'
import { applyLayerToAll, GRANULAR_DEFAULT_LAYER_ORDER, resolveGranularLayer } from './core/layer'
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
  /**
   * UnoCSS-слой, в который уходит всё, что эмитит пресет: FS- и inline-preflight'ы,
   * а также `rules`/`shortcuts` провайдеров (их UnoCSS помечает слоем пресета).
   *
   * По умолчанию — `'granular'`, и пресет сам объявляет его порядок
   * (`GRANULAR_DEFAULT_LAYER_ORDER`), чтобы компонентный CSS шёл до утилит.
   * `null` — не назначать слой вовсе (preflight'ы попадут в `preflights`
   * UnoCSS, правила — в `default`).
   */
  layer?: string | null
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

const debugResolve = createDebug('granular:resolve')

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

  debugResolve(
    `providers=[${providers.map(p => p.id).join(', ')}] `
    + `selected=${resolved.order.length} [${resolved.order.join(', ')}] `
    + `themes=[${themes.names.join(', ')}] safelist=${safelist.length}`,
  )

  return result
}

/**
 * Browser-вариант пресета. Не читает файлы — любые CSS-preflights должен
 * предоставить провайдер (через `GranularUnocssContribution.preflights`)
 * или приложение (через `options.preflights`).
 */
export function presetGranular(options: PresetGranularOptions): Preset {
  const { providers, safelist } = resolvePresetGranular(options)
  const includeProviderUnocss = options.includeProviderUnocss !== false
  const layer = resolveGranularLayer(options.layer)

  const rules: Rule[] = []
  const variants: Variant[] = []
  const providerPreflights: Preflight[] = []

  if (includeProviderUnocss) {
    // Полный развёрнутый список провайдеров (вместе с транзитивными донорами),
    // а НЕ только те, чьи компоненты попали в селекцию: провайдер может быть
    // подключён исключительно ради `unocss.rules`/`variants`, а секции
    // base/tokens/тем node-слой тоже инлайнит от всех провайдеров.
    for (const provider of providers) {
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
    layer,
  )

  return {
    name: 'granular-preset',
    layer,
    // Порядок слоя объявляем сами: без него UnoCSS даст `?? 0` — как у
    // `default`, и наш CSS уехал бы ПОСЛЕ утилит (ничья ломается по алфавиту).
    // Приложение может переопределить это своим `layers` в `defineConfig`.
    ...(layer ? { layers: { [layer]: GRANULAR_DEFAULT_LAYER_ORDER } } : {}),
    safelist: [...safelist],
    preflights,
    // Копии, а не сами кортежи провайдера — см. `cloneRule`.
    rules: uniqueRef(rules).map(cloneRule),
    variants: uniqueRef(variants),
  }
}

/**
 * Возвращает КОПИЮ правила: копируется и сам кортеж, и его `meta`.
 *
 * UnoCSS пишет в `meta` прямо на месте — `resolvePreset` проставляет
 * `meta.layer = preset.layer` (и только если `meta.layer == null`), а
 * `resolveConfig` — `meta.__index`. Кортежи приходят к нам из
 * `provider.unocss.rules`, то есть из объекта, который приложение обычно
 * держит одним инстансом на весь процесс. Без копии слой первого созданного
 * генератора «прилипал» бы к правилам провайдера навсегда, и второй конфиг с
 * другим `layer` уже не смог бы его переопределить (проверка на `== null`).
 *
 * Проявляется в монорепе с несколькими `uno.config.ts` в одном Vite-процессе
 * и в тестах: CSS уезжает не в тот слой в зависимости от порядка создания
 * генераторов.
 */
function cloneRule(rule: Rule): Rule {
  const copy = [...rule] as unknown as unknown[]
  const meta = copy[2]
  if (meta && typeof meta === 'object')
    copy[2] = { ...meta as Record<string, unknown> }
  return copy as unknown as Rule
}
