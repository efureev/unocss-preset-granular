import {xTokenizedNodeConfig} from '../components/XTokenized/config.node'
import {browserComponents, createSimpleProvider} from './index'

export {PACKAGE_BASE_URL, PROVIDER_ID, createSimpleProvider} from './index'

/**
 * NODE-вариант провайдера: те же компоненты, но `XTokenized` берётся из
 * `config.node.ts` — с токенами темы, вычитанными из CSS.
 *
 * Именно этот entry подключают `uno.config.ts` приложений. Браузерный
 * `./granular-provider` остаётся свободным от `node:`-импортов.
 */
export const simpleProviderNode = createSimpleProvider(
    browserComponents.map(c => (c.name === 'XTokenized' ? xTokenizedNodeConfig : c)),
)

export default simpleProviderNode
