import type { LocaleLoaderCollection } from './types'

import { en } from './en'
import { es } from './es'
import { ptBR } from './ptBR'
import { ru } from './ru'

/**
 * Толстый агрегат для демо, e2e и тулинга: МАССИВ коллекций, default-экспортом.
 *
 * В production-бандле равносилен отказу от tree-shaking языков — на то и
 * отдельный подпуть, чтобы это был осознанный импорт.
 */
export const all: readonly LocaleLoaderCollection[] = [en, ru, ptBR, es]

export default all
