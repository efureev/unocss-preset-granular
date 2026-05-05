import { defineGranularComponent } from '@feugene/unocss-preset-granular/contract'

/**
 * Granular‑компонент с вложенными подпапками. Используется как фикстура
 * проверки контракта `<dist>/components/<Name>/**` — `XNested.vue` импортит
 * `parts/XNestedHeader.vue` и `parts/XNestedFooter.vue`, и их утилитарные
 * классы (`text-7xl`, `tracking-widest`) должны попадать в итоговый CSS
 * приложения через скан скомпилированных чанков `dist/components/XNested/chunks/*.js`.
 */
export const xNestedConfig = defineGranularComponent(import.meta.url, {
  name: 'XNested',
  safelist: [],
})
