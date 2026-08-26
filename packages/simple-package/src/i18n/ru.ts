import type { LocaleLoaderCollection } from './types'

export const ru: LocaleLoaderCollection = {
  ru: {
    simple: () => import('./locales/ru/simple.json'),
  },
}

export default ru
