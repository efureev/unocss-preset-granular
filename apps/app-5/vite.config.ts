import {fileURLToPath, URL} from 'node:url'
import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import {granularI18nPlugin, granularThemesPlugin} from '@feugene/unocss-preset-granular/node'

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
        // Отдаёт `virtual:granular-i18n` — адреса, имена экспортов и покрытие
        // языков. Те же опции: список пакетов у манифеста и у CSS один.
        //
        // `ru-RU` запрошен намеренно: пакет отдаёт `ru`, и связка обязана
        // указать на него. `es` пакет объявляет, но приложение не просит —
        // его словарь не должен доехать до бандла.
        granularI18nPlugin(granularOptions, {locales: ['en', 'ru-RU', 'pt-BR']}),
    ],
})
