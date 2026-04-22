import {defineConfig, presetMini} from 'unocss'
import {granularContent, presetGranularNode, type PresetGranularNodeOptions} from '@feugene/unocss-preset-granular/node'
import simplePkgProvider from '@feugene/simple-package/granular-provider/node'

const granularOptions: PresetGranularNodeOptions = {
    providers: [simplePkgProvider],
    // components: 'all',
    components: ['@feugene/simple-package:XTokenized'],
}

export default defineConfig({
    presets: [
        presetMini({
            variablePrefix: 'ds-',
        }),
        presetGranularNode(granularOptions),
    ],
    // `@unocss/vite` читает `content.filesystem` только из top-level user-config,
    // поэтому подключаем хелпер `granularContent` — он автоматически соберёт
    // globs по выбранным компонентам (+ их транзитивным `dependencies`) и
    // расширит `pipeline.include` до `.js`, чтобы extractor увидел утилитарные
    // классы в скомпилированных SFC‑чанках.
    content: granularContent(granularOptions),
})
