import type { ResolvedThemeItem, ResolvedThemes } from './resolveThemes'

/**
 * Форма `themes.tokenOverrides`.
 *
 * Объявлена здесь, а не в `preset.ts`: направление зависимостей —
 * `preset → core`, и ядро не должно ссылаться на browser-слой ради
 * собственной сигнатуры.
 *
 * Две формы значения темы различаются по типу:
 *   - строка ⇒ плоская форма `{ token: value }` (в ПЕРВИЧНЫЙ селектор темы);
 *   - объект ⇒ вложенная `{ selector: { token: value } }`.
 */
export type ThemeTokenOverrides = Partial<Record<
  string,
  Readonly<Record<string, string | Readonly<Record<string, string>>>>
>>

/** Один слой, записавший значение токена. */
export interface TokenLayerValue {
  /**
   * `provider:<id>` | `component:<Name>` | `app-theme` | `app-override` —
   * метки те же, что показывает `granular doctor` в конфликтах токенов.
   */
  source: string
  value: string
  /**
   * Квалифицированный ключ компонента-автора (`<providerId>:<Name>`) — только
   * у слоёв с `source: 'component:<Name>'`.
   *
   * Существует потому, что `source` несёт лишь ИМЯ компонента, а имена
   * уникальны только внутри провайдера: два пакета вправе объявить свой
   * `Button`. Восстанавливать ключ, приклеивая providerId читателя, значит
   * приписать чужое объявление себе. `source` при этом не трогаем — его
   * формат зафиксирован в `DoctorTokenConflict.sources` и в доках.
   */
  componentKey?: string
  /**
   * Слой БЫЛ написан, но в CSS не уехал. Единственная нынешняя причина —
   * `strictTokens` отбросил override токена, которого не объявил ни один
   * пакетный слой.
   *
   * Слой не выбрасывается из цепочки намеренно: «override написан и отброшен»
   * и «override не писали» — разные факты, и первый сам по себе диагностика.
   * Сегодня о нём сообщает только `console.warn` во время сборки, который в
   * CI тонет.
   */
  skipped?: 'strict-tokens'
}

/** Итог по одному токену в одном селекторе одной темы. */
export interface TokenChain {
  theme: string
  selector: string
  token: string
  /** ВСЕ написанные слои, в порядке применения, включая пропущенные. */
  layers: TokenLayerValue[]
  /**
   * Значение последнего НЕпропущенного слоя.
   * `undefined` ⇒ токена в эмитируемом CSS нет вовсе.
   */
  effective?: string
}

/** Блок токенов под одним селектором — в порядке эмиссии. */
export interface EffectiveThemeBlock {
  selector: string
  /** Токен → цепочка, в порядке первого появления. */
  tokens: Map<string, TokenChain>
}

export interface CollectTokenLayersOptions {
  /**
   * Override токена, не объявленного ни одним ПАКЕТНЫМ слоем, отбрасывается.
   * По умолчанию `false` — неизвестный токен пишется как есть (так приложение
   * добавляет собственный токен через override).
   */
  strictTokens?: boolean
  /**
   * Вызывается на каждый отброшенный override. Печатает ВЫЗЫВАЮЩИЙ:
   * `core/` не знает про консоль.
   */
  onSkippedOverride?: (theme: string, token: string) => void
}

/** Метка источника вклада и, для компонентов, его квалифицированный ключ. */
function sourceOf(item: ResolvedThemeItem): { source: string, componentKey?: string } {
  if (item.appDefined)
    return { source: 'app-theme' }
  if (item.componentName)
    return { source: `component:${item.componentName}`, componentKey: `${item.providerId}:${item.componentName}` }
  return { source: `provider:${item.providerId}` }
}

/**
 * Собирает ПОЛНУЮ картину токенов тем: какие слои писали каждый токен, в каком
 * порядке, и какое значение в итоге уедет в CSS.
 *
 * Это единственный источник правды о значениях. Из него сериализуется CSS
 * (`generateThemeBlocks`), из него же считают `doctor`, `explain`,
 * `granular tokens` и манифест тем. До вынесения на один вопрос «какое
 * значение у токена» в пакете было три расходящихся ответа: `explain` не
 * видел `tokenOverrides`, `computeTokenConflicts` не видел `strictTokens`,
 * а полную картину знал только генератор CSS — и не отдавал наружу.
 *
 * Раскладка по селекторам воспроизводит генератор дословно, включая порядок
 * и краевые случаи: от него зависит порядок блоков в эмитируемом CSS.
 */
export function collectTokenLayers(
  themes: ResolvedThemes,
  tokenOverrides: ThemeTokenOverrides | undefined,
  options: CollectTokenLayersOptions = {},
): Map<string, EffectiveThemeBlock[]> {
  const strict = !!options.strictTokens
  const result = new Map<string, EffectiveThemeBlock[]>()

  for (const themeName of themes.names) {
    const entry = themes.tokenRegistry[themeName]
    const overrides = tokenOverrides?.[themeName]

    // Тот же гейт, что в `collectNodeCssSections`: без вкладов и без
    // overrides темы в CSS нет вовсе.
    if (!entry && !overrides)
      continue

    const blocks = entry?.blocks ?? []
    const primarySelector = blocks[0]?.selector ?? ':root'

    // Провенанс из резолюции. Ключ по паре (селектор, токен); запасной —
    // по одному имени токена, потому что `themes.define` со `extends`
    // переписывает блок темы под НОВЫМ селектором, а вклады провайдеров и
    // компонентов остались записанными под старым.
    const bySelectorToken = new Map<string, TokenLayerValue[]>()
    const byToken = new Map<string, TokenLayerValue[]>()
    for (const item of themes.items) {
      if (item.themeName !== themeName || !item.tokenDefinition)
        continue
      const selector = item.tokenDefinition.selector ?? primarySelector
      const { source, componentKey } = sourceOf(item)
      for (const [token, value] of Object.entries(item.tokenDefinition.tokens)) {
        const layer: TokenLayerValue = componentKey === undefined
          ? { source, value }
          : { source, value, componentKey }
        const key = `${selector}\0${token}`
        const list = bySelectorToken.get(key)
        if (list)
          list.push(layer)
        else
          bySelectorToken.set(key, [layer])
        const flat = byToken.get(token)
        if (flat)
          flat.push(layer)
        else
          byToken.set(token, [layer])
      }
    }

    const order: string[] = []
    const bySelector = new Map<string, Map<string, TokenChain>>()
    const ensure = (selector: string): Map<string, TokenChain> => {
      let tokens = bySelector.get(selector)
      if (!tokens) {
        tokens = new Map()
        bySelector.set(selector, tokens)
        order.push(selector)
      }
      return tokens
    }

    // Один проход: и раскладываем токены по селекторам, и собираем множество
    // известных имён для `strictTokens`.
    //
    // ВАЖНО: `known` — имена ПО ВСЕЙ ТЕМЕ, поверх всех селекторов. Сузить его
    // до «известен в этом селекторе» значит молча сломать мультиселекторные
    // темы: override, целящийся в `[data-theme="dark"]` в токен, объявленный
    // под `.dark`, сегодня проходит.
    const known = new Set<string>()
    for (const block of blocks) {
      const target = ensure(block.selector)
      for (const [token, value] of Object.entries(block.tokens)) {
        const layers = bySelectorToken.get(`${block.selector}\0${token}`)
          ?? byToken.get(token)
          // Токен есть в реестре, но ни один item его не объявлял — так
          // выглядят значения, унаследованные `themes.define` через
          // `extends`: их материализовало приложение.
          ?? [{ source: 'app-theme', value }]
        target.set(token, {
          theme: themeName,
          selector: block.selector,
          token,
          layers: [...layers],
          effective: value,
        })
        known.add(token)
      }
    }

    if (overrides) {
      for (const [key, value] of Object.entries(overrides)) {
        if (typeof value === 'string') {
          applyOverride(ensure(primarySelector), themeName, primarySelector, key, value)
          continue
        }
        // `ensure` ДО цикла по токенам — как в генераторе: селектор, все
        // токены которого отброшены, всё равно занимает своё место в
        // `order`, и от этого зависит порядок последующих.
        const target = ensure(key)
        for (const [token, tokenValue] of Object.entries(value))
          applyOverride(target, themeName, key, token, tokenValue)
      }
    }

    result.set(themeName, order.map(selector => ({
      selector,
      tokens: bySelector.get(selector)!,
    })))

    function applyOverride(
      target: Map<string, TokenChain>,
      theme: string,
      selector: string,
      token: string,
      value: string,
    ): void {
      const dropped = strict && !known.has(token)
      const layer: TokenLayerValue = dropped
        ? { source: 'app-override', value, skipped: 'strict-tokens' }
        : { source: 'app-override', value }

      const chain = target.get(token)
      if (chain) {
        chain.layers.push(layer)
        if (!dropped)
          chain.effective = value
      }
      else {
        target.set(token, {
          theme,
          selector,
          token,
          layers: [layer],
          ...(dropped ? {} : { effective: value }),
        })
      }

      if (dropped)
        options.onSkippedOverride?.(theme, token)
    }
  }

  return result
}
