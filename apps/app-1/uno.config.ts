import {defineConfig, presetMini} from 'unocss'
import {presetGranularNode} from '@feugene/unocss-preset-granular/node'
import granularityProvider from '@feugene/simple-package/granular-provider/node'

export const simplePkgComponents = ['XTest1'] as const
export const app1Layer = 'granular'

export default defineConfig({
    presets: [
        presetMini(),
        presetGranularNode({
            providers: [granularityProvider],
            components: [
                {
                    provider: '@feugene/simple-package',
                    names: [...simplePkgComponents],
                },
            ],
            themes: {
                tokenOverrides: {
                    light: {
                        brd: 'red'
                    }
                }
            },
            layer: app1Layer,
        }),
    ],
})
