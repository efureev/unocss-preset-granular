import {defineConfig, presetMini} from 'unocss'
import {granularContent, presetGranularNode, type PresetGranularNodeOptions} from '@feugene/unocss-preset-granular/node'
import {
    animationPreflights,
    animationRules,
    colorOpacityRules,
    filterRules,
    spacingRules,
    spacingVariants,
} from '@feugene/unocss-mini-extra-rules'
import xSimplePkgProvider from '@feugene/extra-simple-package/granular-provider/node'

const granularOptions: PresetGranularNodeOptions = {
    providers: [xSimplePkgProvider],
    // components: 'all',
    components: [
        '@feugene/extra-simple-package:XTokenizedLevel2',
    ],
    layer: 'granular',
    // themes: {
    //     names: ['light', 'dark']
    // }
}

export default defineConfig({
    presets: [
        presetMini({
            variablePrefix: 'ds-',
        }),
        presetGranularNode(granularOptions),
    ],
    // Дополнительные правила поверх preset-mini из
    // `@feugene/unocss-mini-extra-rules`: spinner-анимация, bracket‑color с
    // `/NN` opacity, расширенные filter/backdrop‑filter утилиты и
    // Tailwind‑совместимые `space-*` / `divide-*`.
    rules: [
        ...animationRules,
        ...colorOpacityRules,
        ...filterRules,
        ...spacingRules,
    ],
    variants: [
        ...spacingVariants,
    ],
    preflights: [
        ...animationPreflights,
    ],
    // `@unocss/vite` читает `content.filesystem` только из top-level user-config,
    // поэтому подключаем хелпер `granularContent` — он автоматически соберёт
    // globs по выбранным компонентам (+ их транзитивным `dependencies`) и yarn
    // расширит `pipeline.include` до `.js`, чтобы extractor увидел утилитарные
    // классы в скомпилированных SFC‑чанках.
    content: granularContent(granularOptions),
})
