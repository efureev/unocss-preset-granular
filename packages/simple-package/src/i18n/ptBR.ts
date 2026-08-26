import type { LocaleLoaderCollection } from './types'

/**
 * Имя экспорта — `ptBR`, ключ коллекции — `pt-BR`.
 *
 * Это не описка: `pt-BR` не может быть идентификатором, поэтому конвенция
 * `fint-i18n` требует camelCase у экспорта, а ключом остаётся тег — по нему
 * рантайм ищет лоадеры. Ровно это расхождение и разводит `GranularI18nBinding`
 * на `locale` и `exportName`.
 */
export const ptBR: LocaleLoaderCollection = {
  'pt-BR': {
    simple: () => import('./locales/pt-BR/simple.json'),
  },
}

export default ptBR
