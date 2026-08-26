import type { LocaleLoaderCollection } from './types'

/**
 * Локаль, которую приложения репозитория НЕ запрашивают.
 *
 * Существует затем, чтобы `verify:apps` мог доказать отсечение: её словарь
 * обязан отсутствовать в сборке приложения. Без неё «tree-shaking языков»
 * оставался бы утверждением документации.
 */
export const es: LocaleLoaderCollection = {
  es: {
    simple: () => import('./locales/es/simple.json'),
  },
}

export default es
