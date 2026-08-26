import {fileURLToPath, URL} from 'node:url'
import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import {granularThemesPlugin} from '@feugene/unocss-preset-granular/node'

import {granularOptions} from './uno.config'

export default defineConfig({
    root: fileURLToPath(new URL('./', import.meta.url)),
    base: '/app-5/',
    plugins: [
        vue(),
        UnoCSS({
            configFile: fileURLToPath(new URL('./uno.config.ts', import.meta.url)),
        }),
        // Отдаёт `virtual:granular-themes` — имена тем и селекторы их
        // активации. Те же опции, что у пресета: манифест и CSS считаются из
        // одной резолюции и разъехаться не могут.
        granularThemesPlugin(granularOptions),
    ],
})
