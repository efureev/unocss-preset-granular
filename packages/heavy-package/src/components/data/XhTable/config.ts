import { defineGranularComponent } from '@feugene/unocss-preset-granular/contract'

/**
 * Негативный контроль стенда: в селекцию не входит НИКОГДА. Его токены
 * (`--xh-table-*`) и классы (`.xh-table`) обязаны отсутствовать в
 * дистрибутиве подопытного приложения — это и доказывает, что гранулярный
 * отбор работает, а метрика не считает мёртвым то, чего в сборке нет.
 */
export const xhTableConfig = defineGranularComponent(import.meta.url, {
  name: 'XhTable',
  group: 'data',
})
