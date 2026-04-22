import {defineConfig, presetMini, transformerDirectives, transformerCompileClass} from 'unocss'
import {granularContent, presetGranularNode, type PresetGranularNodeOptions} from '@feugene/unocss-preset-granular/node'
import granularityProvider from '@feugene/simple-package/granular-provider/node'

export const simplePkgComponents = ['XTest1'] as const

const granularOptions: PresetGranularNodeOptions = {
    providers: [granularityProvider],
    components: [
        {
            provider: '@feugene/simple-package',
            names: [...simplePkgComponents],
        },
    ],
    layer: 'granular',
}

export default defineConfig({
    presets: [
        presetMini({
            variablePrefix: 'ds-',
        }),
        presetGranularNode(granularOptions),
    ],
    content: granularContent(granularOptions),
    transformers: [transformerDirectives(), transformerCompileClass()],
})
