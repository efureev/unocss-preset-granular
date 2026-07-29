import {tokenDefinitionsFromCssSync} from '@feugene/unocss-preset-granular/node'

import {xTokenizedConfig} from './config'

const lightCssUrl = new URL('./themes/light.css', import.meta.url).href
const darkCssUrl = new URL('./themes/dark.css', import.meta.url).href

/**
 * NODE-конфиг того же компонента: браузерный дескриптор плюс токены темы,
 * вычитанные из CSS на этапе загрузки конфига.
 *
 * Читает файлы, поэтому импортируется ТОЛЬКО из `granular-provider/node.ts`.
 * Разделение с `config.ts` — единственный способ не утащить `node:fs`
 * в браузерный экспорт провайдера.
 */
export const xTokenizedNodeConfig = {
    ...xTokenizedConfig,
    tokenDefinitions: {
        light: tokenDefinitionsFromCssSync(lightCssUrl, {selector: ':root'}),
        // значения лежат в одном блоке с составным селектором — берём его
        // и переозначиваем под `.dark, [data-theme="dark"]`
        dark: tokenDefinitionsFromCssSync(darkCssUrl, {as: '.dark, [data-theme="dark"]'}),
    },
}
