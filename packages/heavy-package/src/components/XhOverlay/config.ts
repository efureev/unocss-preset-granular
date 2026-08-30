import { defineGranularComponent } from '@feugene/unocss-preset-granular/contract'

/**
 * Компонент собирает `var()` в рантайме, а имя токена лежит в ОБЩЕМ модуле
 * (`components/shared/overlayZ.ts`), который бандлер кладёт в `dist/chunks/`
 * — вне скан-директорий. Ни один статический канал его не видит.
 *
 * Без строки ниже обрезка удалит `--xh-z-dropdown` молча: сборка зелёная,
 * `z-index` разрешается в `unset`, оверлей уезжает под соседний слой.
 */
export const xhOverlayConfig = defineGranularComponent(import.meta.url, {
  name: 'XhOverlay',
  dynamicTokens: ['xh-z-dropdown'],
})
