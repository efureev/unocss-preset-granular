import {defineGranularProvider, type GranularProvider, resolvePackageBaseUrl} from '@feugene/unocss-preset-granular/contract'

import {xNestedConfig} from '../components/XNested/config'
import {xXNestedReverseConfig} from '../components/reverses/XNestedReverse/config'
import {xGroupAOneConfig} from '../components/groupA/XGroupAOne/config'
import {xGroupATwoConfig} from '../components/groupA/XGroupATwo/config'
import {xTest1Config} from '../components/XTest1/config'
import {xTestStyledConfig} from '../components/XTestStyled/config'
import {xTokenizedConfig} from '../components/XTokenized/config'

export const PROVIDER_ID = '@feugene/simple-package'

/**
 * Granular‑provider пакета `@feugene/simple-package`.
 *
 * Подключается в опцию `providers` пресета:
 *
 * ```ts
 * presetGranularNode({
 *   providers: [simpleProvider],
 *   components: ['@feugene/simple-package:XTest1'],
 * })
 * ```
 *
 * Провайдер НЕ объявляет `theme` — темы этого пакета живут на уровне
 * компонента (`XTokenized/config.ts`, `tokenDefinitionsRef`). Так и задумано:
 * набор тем принадлежит приложению, пакет поставляет лишь значения токенов
 * (см. `apps/app-6` — приложение с собственными темами).
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
 * Фабрика провайдера. Оставлена на случай, если понадобится собрать провайдера
 * с другим набором компонентов (в т.ч. из node-entry).
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
