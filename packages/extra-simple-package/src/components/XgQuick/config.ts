import {defineGranularComponent} from '@feugene/unocss-preset-granular/contract'

/**
 * Granular‑конфиг композита `XgQuick`.
 */
export const xgQuickConfig = defineGranularComponent(import.meta.url, {
    name: 'XgQuick',
    dependencies: [
        '@feugene/simple-package:XTest1'
        // '@feugene/simple-package:XTestStyled'
    ],
    safelist: [],
    // cssFiles: ['./styles.css'],
})
