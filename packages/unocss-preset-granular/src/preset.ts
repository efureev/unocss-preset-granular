import type { Preflight, Preset, Rule, Variant } from '@unocss/core'

import type { GranularProvider } from './contract'

import type { ComponentSelection, ResolvedComponents } from './core/resolveSelection'
import type { ResolvedThemes, ResolveThemesInput } from './core/resolveThemes'
import type { ThemeTokenOverrides } from './core/tokenLayers'
import {
  accessibilityRules,
  animationPreflights,
  animationRules,
  colorOpacityRules,
  filterRules,
  numericPreflights,
  numericRules,
  objectRules,
  spacingRules,
  spacingVariants,
  typographyRules,
} from '@feugene/unocss-mini-extra-rules'
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

/**
 * Настройки тем приложения.
 *
 * Три уровня влияния, от объявления к патчу:
 *
 *   1. `names` / `define` — КАКИЕ темы существуют в сборке. `define` позволяет
 *      приложению объявить собственные темы (в том числе полностью заменив
 *      `light`/`dark` провайдеров) — см. `GranularAppThemeDefinition`.
 *   2. `themeFiles` / `baseFile` / `tokensFile` — подмена CSS-ФАЙЛОВ, которые
 *      объявили провайдеры.
 *   3. `tokenOverrides` — точечная подмена отдельных ЗНАЧЕНИЙ.
 *
 * Итоговый приоритет токенов: провайдеры → компоненты → `define` →
 * `tokenOverrides`.
 */
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
  tokenOverrides?: ThemeTokenOverrides

  /**
   * Если `true` — override токена, которого нет ни в одном блоке темы
   * (у провайдеров и компонентов), ПРОПУСКАЕТСЯ с `console.warn`; сборка
   * продолжается. По умолчанию — `false`: неизвестный токен пишется как есть
   * (так приложение может добавить собственный токен через override).
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
  /**
   * Добирать ли утилиты, которых нет в `presetMini`, из
   * `@feugene/unocss-mini-extra-rules` (default: `true`).
   *
   * Это не удобство, а условие работоспособности провайдеров. `presetMini` не
   * знает `animate-*`, `space-*`, `divide-*`, `backdrop-*` и всё семейство
   * `text-transform`, а компоненты их используют. Без этих правил класс
   * остаётся в разметке, CSS не появляется, и сборка молча проходит: спиннер не
   * крутится, разделители не красятся, заголовок не переходит в капитель.
   * Ловится такое только глазами на живом приложении.
   *
   * Правила добавляются ПЕРЕД правилами провайдеров, чтобы провайдер мог
   * перекрыть любое из них своим.
   *
   * `false` — если приложение подмешивает эти же правила само (иначе они просто
   * продублируются, что безвредно) или сознательно обходится без них.
   */
  includeExtraRules?: boolean
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
  const extraPreflights: Preflight[] = []

  // Идут первыми: UnoCSS отдаёт совпадение ПОСЛЕДНЕМУ подходящему правилу,
  // поэтому одноимённое правило провайдера перекроет базовое, а не наоборот.
  if (options.includeExtraRules !== false) {
    rules.push(
      ...accessibilityRules,
      ...animationRules,
      ...colorOpacityRules,
      ...filterRules,
      ...numericRules,
      ...objectRules,
      ...spacingRules,
      ...typographyRules,
    )
    variants.push(...spacingVariants)
    // `animate-spin` ссылается на `@keyframes granularity-spin`; без preflight
    // правило сгенерируется, а анимации не будет.
    extraPreflights.push(...animationPreflights)
    // `tabular-nums` и соседи собирают `font-variant-numeric` из пяти
    // переменных; без preflight они не объявлены, и свойство схлопывается.
    extraPreflights.push(...numericPreflights)
  }

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
    [...extraPreflights, ...providerPreflights, ...(options.preflights ?? [])],
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
