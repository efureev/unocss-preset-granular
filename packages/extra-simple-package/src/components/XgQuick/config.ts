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
    /**
     * Собственный CSS компонента. Пакет НЕ использует `libInjectCss`, поэтому
     * его dist-JS не импортирует стили сам — без этой строки `.xg-quick`
     * не доезжал до приложения вовсе (проверено на app-3).
     *
     * Пресет инлайнит файл в preflight granular-слоя; в опубликованном пакете
     * (без исходников) node-слой возьмёт его по `cssFileAssetNames`, то есть
     * из `components/XgQuick/styles.css`, куда его кладёт
     * `granularAssetFileNames()` в `vite.config.ts`.
     */
    cssFiles: ['./styles.css'],
})
