import {defineConfig, presetMini, transformerDirectives} from 'unocss'
import {granularContent, presetGranularNode} from '@feugene/unocss-preset-granular/node'
import extraSimplePkgProvider from '@feugene/extra-simple-package/granular-provider/node'

export const app3Layer = 'granular'

const granularOptions = {
    // `@feugene/simple-package` тянется транзитивно через
    // `extraSimplePkgProvider.dependencies`.
    providers: [extraSimplePkgProvider],
    components: [
        {
            provider: '@feugene/extra-simple-package',
            names: ['XgQuick'] as const,
        },
    ],
    layer: app3Layer,
}

export default defineConfig({
    presets: [
        presetMini(),
        presetGranularNode(granularOptions),
    ],
    transformers: [
        transformerDirectives(),
    ],
    // `@unocss/vite` читает `content.filesystem` только из top-level user-config,
    // поэтому подключаем хелпер `granularContent` — он автоматически соберёт
    // globs по выбранным компонентам (+ их транзитивным `dependencies`) и
    // расширит `pipeline.include` до `.js`, чтобы extractor увидел утилитарные
    // классы в скомпилированных SFC‑чанках.
    content: granularContent(granularOptions),
})
