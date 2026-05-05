import { defineGranularComponent } from '@feugene/unocss-preset-granular/contract'

/**
 * Парный компонент группы `groupA`. См. `XGroupAOne/config.ts` —
 * shared-чанк `XGroupASharedHeader.vue` создаётся именно из-за двух
 * entry-компонентов одной группы, импортирующих один и тот же SFC.
 */
export const xGroupATwoConfig = defineGranularComponent(import.meta.url, {
  name: 'XGroupATwo',
  group: 'groupA',
  safelist: [],
})
