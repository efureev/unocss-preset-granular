/**
 * Барель строк пакета — по одному ИМЕНОВАННОМУ экспорту на локаль.
 *
 * Агрегат `all` отсюда НЕ реэкспортируется: тогда `import { en }` затащил бы в
 * граф и `ru`, и `es`, и весь смысл per-locale экспортов пропал бы. Он живёт
 * отдельным подпутём `./i18n/all`.
 */
export { en } from './en'
export { es } from './es'
export { ptBR } from './ptBR'
export { ru } from './ru'
export type { LocaleLoaderCollection } from './types'
