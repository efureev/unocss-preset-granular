import {defineConfig, presetMini} from 'unocss'
import {granularContent, presetGranularNode, type PresetGranularNodeOptions} from '@feugene/unocss-preset-granular/node'
import simplePkgProvider from '@feugene/simple-package/granular-provider/node'

/**
 * Один и тот же объект опций уходит в пресет, в `granularContent` и в
 * `granularThemesPlugin` (см. vite.config.ts) — на его идентичности держится
 * мемоизация резолва, а заодно гарантия, что манифест тем описывает ровно тот
 * CSS, который эмитит пресет.
 */
export const granularOptions: PresetGranularNodeOptions = {
    providers: [simplePkgProvider],
    components: [
        // XTokenized объявляет tokenDefinitions для light и dark —
        // именно из них резолвятся селекторы, попадающие в манифест.
        '@feugene/simple-package:XTokenized',
    ],
    themes: {
        names: ['light', 'dark'],
    },
}

export default defineConfig({
    presets: [
        presetMini(),
        presetGranularNode(granularOptions),
    ],
    content: granularContent(granularOptions),
})
