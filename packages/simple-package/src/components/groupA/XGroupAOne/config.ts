import { defineGranularComponent } from '@feugene/unocss-preset-granular/contract'

/**
 * Granular-компонент группы `groupA`. Делит общий SFC
 * `groupA/shared/XGroupASharedHeader.vue` с `XGroupATwo`. Build (через
 * `granularChunkFileNames()`) кладёт этот shared-чанк в
 * `dist/groups/groupA/shared/`, а пресет благодаря `group: 'groupA'`
 * сканирует эту папку дополнительно к `dist/components/XGroupAOne/`.
 */
export const xGroupAOneConfig = defineGranularComponent(import.meta.url, {
  name: 'XGroupAOne',
  group: 'groupA',
})
