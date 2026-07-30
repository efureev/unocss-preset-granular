import {defineConfig, presetMini} from 'unocss'
import {granularContent, presetGranularNode, type PresetGranularNodeOptions} from '@feugene/unocss-preset-granular/node'
import simplePkgProvider from '@feugene/simple-package/granular-provider/node'

/**
 * Приложение с СОБСТВЕННЫМ набором тем.
 *
 * Провайдер `@feugene/simple-package` поставляет `light` и `dark` — здесь нет
 * ни той, ни другой. Вместо них три темы приложения, и это не обход контракта,
 * а штатный режим: набор тем принадлежит приложению, провайдер лишь поставляет
 * значения, из которых его можно собрать.
 *
 * `themes.define` без `themes.names` означает «список тем — это ключи define».
 * Провайдерские `defaultThemes` в этом случае не смотрятся вовсе.
 */
export const granularOptions: PresetGranularNodeOptions = {
    providers: [simplePkgProvider],
    components: [
        // XTokenized объявляет tokenDefinitionsRef для light и dark.
        // `light` мы наследуем; `dark` не активна и в CSS не попадёт.
        '@feugene/simple-package:XTokenized',
    ],
    themes: {
        define: {
            emerald: {
                // Берём эффективные токены темы `light` провайдера за основу.
                // Саму `light` в сборку это не добавляет — она резолвится
                // только чтобы было что унаследовать.
                extends: 'light',
                tokens: {
                    'app-bg': '#052e1f',
                    'app-fg': '#d1fae5',
                    'app-accent': '#10b981',
                    'app-muted': '#065f46',
                    // Токен провайдерского компонента переопределяем поимённо.
                    'x-tokenized': '#34d399',
                },
                label: 'Изумруд',
                colorScheme: 'dark',
            },

            ocean: {
                extends: 'light',
                tokens: {
                    'app-bg': '#e0f2fe',
                    'app-fg': '#0c4a6e',
                    'app-accent': '#0284c7',
                    'app-muted': '#7dd3fc',
                    'x-tokenized': '#0369a1',
                },
                label: 'Океан',
                colorScheme: 'light',
            },

            crimson: {
                extends: 'light',
                // Палитра — в CSS-файле; читает его node-слой пресета.
                // `--x-tokenized` тут НЕ переопределён: он приходит из
                // унаследованной `light` провайдера, и это видно в собранном CSS.
                tokensRef: new URL('./src/themes/crimson.css', import.meta.url).href,
                label: 'Багрянец',
                colorScheme: 'dark',
            },
        },
    },
}

export default defineConfig({
    presets: [
        presetMini(),
        presetGranularNode(granularOptions),
    ],
    content: granularContent(granularOptions),
})
