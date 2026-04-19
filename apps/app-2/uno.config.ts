import {defineConfig, presetMini} from 'unocss'
import {presetGranularNode} from '@feugene/unocss-preset-granular/node'
import granularityProvider from '@feugene/simple-package/granular-provider/node'

export const simplePkgComponents = ['XTestStyled'] as const
export const app2Layer = 'granular'

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
                        brd:       '#02f8fa',
                        'card-fg': '#af172a',
                    }
                }
            },
            layer: app2Layer,
        }),
    ],
})
