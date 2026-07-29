import {defineGranularProvider, type GranularProvider, resolvePackageBaseUrl} from '@feugene/unocss-preset-granular/contract'

import {xNestedConfig} from '../components/XNested/config'
import {xXNestedReverseConfig} from '../components/reverses/XNestedReverse/config'
import {xGroupAOneConfig} from '../components/groupA/XGroupAOne/config'
import {xGroupATwoConfig} from '../components/groupA/XGroupATwo/config'
import {xTest1Config} from '../components/XTest1/config'
import {xTestStyledConfig} from '../components/XTestStyled/config'
import {xTokenizedConfig} from '../components/XTokenized/config'

export const PROVIDER_ID = '@feugene/simple-package'

// const lightCssUrl = new URL('../styles/themes/light.css', import.meta.url).href
// const darkCssUrl = new URL('../styles/themes/dark.css', import.meta.url).href

/**
 * Granular‑provider пакета `@feugene/extra-granularity`.
 *
 * Подключается вместе с `@feugene/granularity` в опцию `providers` пресета:
 *
 * ```ts
 * presetGranularNode({
 *   providers: [granularityProvider, extraProvider],
 *   components: ['@feugene/simple-package:xTest1'],
 * })
 * ```
 *
 * Композитные компоненты декларируют свои зависимости на примитивы granularity
 * через `dependencies` в `config.ts` — ядро пресета рекурсивно соберёт safelist
 * и CSS всех транзитивных компонентов.
 */
/**
 * Базовый URL пакета. Вынесен сюда, чтобы node-entry считал его от ТОГО ЖЕ
 * модуля: оба entry делят общий чанк, поэтому значение одинаково.
 *
 * `resolvePackageBaseUrl` — вместо рукописного слайса и вместо литерального
 * `new URL('..', import.meta.url)`, который rolldown заменяет на `data:`-URL.
 */
export const PACKAGE_BASE_URL = resolvePackageBaseUrl(import.meta.url)

/** Браузерные конфиги компонентов — без единого FS-импорта. */
export const browserComponents = [
    xTest1Config,
    xTestStyledConfig,
    xTokenizedConfig,
    xNestedConfig,
    xXNestedReverseConfig,
    xGroupAOneConfig,
    xGroupATwoConfig,
]

/**
 * Фабрика провайдера. Node-entry (`./node.ts`) вызывает её с теми же
 * компонентами, подменив те, у которых есть `config.node.ts` — так browser- и
 * node-варианты не разъезжаются по id/базовому URL.
 */
export function createSimpleProvider(components: typeof browserComponents): GranularProvider {
    return defineGranularProvider({
        id: PROVIDER_ID,
        contractVersion: 1,
        packageBaseUrl: PACKAGE_BASE_URL,
        components,
    })
}

export const simpleProvider: GranularProvider = createSimpleProvider(browserComponents)

export default simpleProvider
