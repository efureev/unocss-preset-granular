import simpleProviderNode from '@feugene/simple-package/granular-provider/node'

import { createExtraProvider } from './index'

export { createExtraProvider, EXTRA_SIMPLE_PROVIDER_ID, PACKAGE_BASE_URL } from './index'

/**
 * NODE-вариант: тот же провайдер, но донор берётся из node-entry — с
 * `tokenDefinitions`, вычитанными из CSS. Именно его подключают `uno.config.ts`
 * приложений.
 */
export const extraGranularityProviderNode = createExtraProvider(simpleProviderNode)

export default extraGranularityProviderNode
