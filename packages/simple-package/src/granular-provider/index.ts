import {defineGranularProvider, type GranularProvider} from '@feugene/unocss-preset-granular/contract'
import {tokenDefinitionsFromCssSync} from '@feugene/unocss-preset-granular/node'

import {xTest1Config} from '../components/XTest1/config'
import {xTestStyledConfig} from '../components/XTestStyled/config'
import {xTokenizedConfig} from '../components/XTokenized/config'

export const PROVIDER_ID = '@feugene/simple-package'

const lightCssUrl = new URL('../styles/themes/light.css', import.meta.url).href
const darkCssUrl = new URL('../styles/themes/dark.css', import.meta.url).href

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
export const simpleProvider: GranularProvider = defineGranularProvider({
    id: PROVIDER_ID,
    contractVersion: 1,
    packageBaseUrl: `${import.meta.url.slice(0, import.meta.url.lastIndexOf('/', import.meta.url.lastIndexOf('/') - 1) + 1)}`,
    components: [xTest1Config, xTestStyledConfig, xTokenizedConfig],
    // theme: {
        // baseCssUrl: new URL('../styles/base.css', import.meta.url).href,
        // tokenDefinitions: {
        //     light: tokenDefinitionsFromCssSync(lightCssUrl, {selector: ':root'}),
        //     значения лежат в `:root`, но эмитим под селектором `.dark`
        //     в файле один блок с составным селектором — берём его и переозначиваем
            // dark: tokenDefinitionsFromCssSync(darkCssUrl, {as: '.dark, [data-theme="dark"]'}),
        // },
        // defaultThemes: ['light'],
    // }
})

export default simpleProvider
