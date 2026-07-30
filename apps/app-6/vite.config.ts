import {fileURLToPath, URL} from 'node:url'
import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import {granularThemesPlugin} from '@feugene/unocss-preset-granular/node'

import {granularOptions} from './uno.config'

export default defineConfig({
    root: fileURLToPath(new URL('./', import.meta.url)),
    base: '/app-6/',
    plugins: [
        vue(),
        UnoCSS({
            configFile: fileURLToPath(new URL('./uno.config.ts', import.meta.url)),
        }),
        // Манифест несёт не только селекторы активации, но и `label`/`colorScheme`
        // из `themes.define` — переключателю в UI больше неоткуда их взять,
        // а вторая рукописная карта «имя → подпись» разъезжалась бы с конфигом.
        granularThemesPlugin(granularOptions),
    ],
})
