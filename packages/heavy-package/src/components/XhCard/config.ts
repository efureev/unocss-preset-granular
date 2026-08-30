import { defineGranularComponent } from '@feugene/unocss-preset-granular/contract'

/**
 * Ни одной записи `safelist`: все классы статические и лежат в шаблоне.
 * Компонент существует как контрольная точка — если его токены не доехали,
 * сломан скан, а не декларация.
 */
export const xhCardConfig = defineGranularComponent(import.meta.url, {
  name: 'XhCard',
})
