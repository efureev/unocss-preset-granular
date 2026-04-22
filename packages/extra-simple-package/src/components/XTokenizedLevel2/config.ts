import {defineGranularComponent} from '@feugene/unocss-preset-granular/contract'

export const xTokenizedLevel2Config = defineGranularComponent(import.meta.url, {
    name: 'XTokenizedLevel2',
    dependencies: [
        '@feugene/simple-package:XTokenized'
    ],
    safelist: [],
})
