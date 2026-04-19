import type { Preflight } from '@unocss/core'

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
