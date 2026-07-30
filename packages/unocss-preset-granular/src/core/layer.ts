import type { Preflight } from '@unocss/core'

/** Имя слоя, в который пресет складывает всё, что эмитит, если не задано иное. */
export const GRANULAR_DEFAULT_LAYER = 'granular'

/**
 * Порядок слоя granular относительно встроенных слоёв UnoCSS
 * (`imports: -200`, `preflights: -100`, `shortcuts: -10`, `default: 0`).
 *
 * −50 ставит компонентный CSS ПОСЛЕ ресетов и preflight'ов других пресетов,
 * но ДО shortcut'ов и утилит — то есть утилита (`p-5`) перебивает базовый
 * стиль компонента, как и ожидается в utility-first.
 *
 * Без этого объявления слой получал бы порядок `?? 0`, то есть тот же, что у
 * `default`, а ничья ломается по алфавиту — `granular` уезжал БЫ после утилит
 * и молча начинал их перебивать. Приложение может переопределить порядок
 * своим `layers` в `defineConfig` (пользовательский конфиг мержится последним).
 */
export const GRANULAR_DEFAULT_LAYER_ORDER = -50

/**
 * Итоговое имя слоя по опции пользователя.
 *
 *   - `undefined` → {@link GRANULAR_DEFAULT_LAYER};
 *   - `null`      → слоя нет вовсе (preflight'ы уйдут в `preflights` UnoCSS,
 *                   правила — в `default`);
 *   - строка      → она же.
 */
export function resolveGranularLayer(layer: string | null | undefined): string | undefined {
  if (layer === null)
    return undefined
  return layer ?? GRANULAR_DEFAULT_LAYER
}

/** Проставляет `layer`, если у preflight ещё нет своего. */
export function applyLayer(preflight: Preflight, layer?: string): Preflight {
  if (!layer || preflight.layer)
    return preflight
  return { ...preflight, layer }
}

export function applyLayerToAll(
  preflights: readonly Preflight[],
  layer?: string,
): Preflight[] {
  return preflights.map(p => applyLayer(p, layer))
}
