import { defineGranularComponent } from '@feugene/unocss-preset-granular/contract'

/** Второй член группы `data` — делит с `XhTable` общий SFC. */
export const xhListConfig = defineGranularComponent(import.meta.url, {
  name: 'XhList',
  group: 'data',
})
