import { defineGranularComponent } from '@feugene/unocss-preset-granular/contract'

/**
 * Подопытный компонент стенда: одна запись в `components` разворачивает граф
 * из пяти. Плюс единственный в пакете объявленный `cssFiles` — канал
 * `component-css` индекса потребления токенов.
 */
export const xhPanelConfig = defineGranularComponent(import.meta.url, {
  name: 'XhPanel',
  dependencies: ['XhCard', 'XhButton', 'XhAlert', 'XhOverlay'],
  cssFiles: ['./styles.css'],
})
