import type { LocaleLoaderCollection } from './types'

export const en: LocaleLoaderCollection = {
  en: {
    simple: () => import('./locales/en/simple.json'),
  },
}

export default en
