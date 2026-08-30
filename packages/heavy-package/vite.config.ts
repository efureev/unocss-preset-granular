import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { libInjectCss } from 'vite-plugin-lib-inject-css'
import { granularAssetFileNames, granularChunkFileNames, granularCssAssetsPlugin } from '@feugene/unocss-preset-granular/vite'

import { xhPanelConfig } from './src/components/XhPanel/config'

/** Имена granular-компонентов пакета — источник правды для entry и ассетов. */
const COMPONENT_NAMES = [
  'XhCard',
  'XhButton',
  'XhAlert',
  'XhOverlay',
  'XhPanel',
  'XhTable',
  'XhList',
]

export default defineConfig({
  plugins: [
    vue(),
    libInjectCss(),
    // `XhPanel/styles.css` объявлен в `cssFiles` СТРОКОЙ — бандлер про такую
    // ссылку ничего не знает и файл в `dist` не положит. Плагин кладёт его по
    // `assetName`, то есть ровно туда, куда смотрит фолбэк node-слоя.
    //
    // Альтернатива `<style src="./styles.css">` в SFC (так сделано в
    // `extra-simple-package`) здесь не годится: с `libInjectCss` чанк
    // компонента импортировал бы этот CSS сам, и правила приехали бы дважды —
    // из клиентского бандла и из preflight'а пресета.
    granularCssAssetsPlugin({ components: [xhPanelConfig] }),
  ],
  build: {
    target: 'esnext',
    minify: 'oxc',
    reportCompressedSize: true,
    emptyOutDir: true,
    cssCodeSplit: true,
    lib: {
      entry: {
        index: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        'components/XhCard/index': fileURLToPath(new URL('./src/components/XhCard/index.ts', import.meta.url)),
        'components/XhButton/index': fileURLToPath(new URL('./src/components/XhButton/index.ts', import.meta.url)),
        'components/XhAlert/index': fileURLToPath(new URL('./src/components/XhAlert/index.ts', import.meta.url)),
        'components/XhOverlay/index': fileURLToPath(new URL('./src/components/XhOverlay/index.ts', import.meta.url)),
        'components/XhPanel/index': fileURLToPath(new URL('./src/components/XhPanel/index.ts', import.meta.url)),
        // Общий модуль оверлеев — ЯВНЫЙ entry вне `components/`.
        //
        // Он воспроизводит живой случай `@feugene/granularity`
        // (`composables/internal/overlayStack.ts` → `dist/chunks/`): имя токена
        // лежит строковым литералом в модуле, который ни в одну
        // скан-директорию не попадает. Оставить его обычным общим модулем
        // нельзя — ролдаун волен ИНЛАЙНИТЬ такой модуль в чанк компонента, и
        // тогда фикстура перестаёт воспроизводить то, ради чего заведена
        // (проверено: инлайнил).
        'internal/overlayZ': fileURLToPath(new URL('./src/components/shared/overlayZ.ts', import.meta.url)),
        // Группа `data`: оба entry импортируют общий SFC
        // `data/shared/XhDataHeader.vue`, и `granularChunkFileNames()` кладёт
        // его в `dist/groups/data/shared/`, куда пресет ходит по `group`.
        'components/XhTable/index': fileURLToPath(new URL('./src/components/data/XhTable/index.ts', import.meta.url)),
        'components/XhList/index': fileURLToPath(new URL('./src/components/data/XhList/index.ts', import.meta.url)),
        // `shared` — ЯВНЫЙ entry, а не общий чанк. От этого зависит
        // `packageBaseUrl`: `resolvePackageBaseUrl(import.meta.url)` считает
        // базу от места, куда бандлер положил модуль, и `levelsUp = 1` верен
        // ровно для `<base>/<подкаталог>/`. Общий чанк ролдаун волен
        // ИНЛАЙНИТЬ в entry — тогда модуль оказывается в `dist/` корнем,
        // база уезжает на уровень выше пакета, скан пустеет, и всё это без
        // единой ошибки. Явный entry такой свободы не оставляет.
        'granular-provider/shared': fileURLToPath(new URL('./src/granular-provider/shared.ts', import.meta.url)),
        'granular-provider': fileURLToPath(new URL('./src/granular-provider/index.ts', import.meta.url)),
        'granular-provider-node': fileURLToPath(new URL('./src/granular-provider/node.ts', import.meta.url)),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rolldownOptions: {
      external: [
        /^node:/,
        'vue',
        /^@feugene\/unocss-preset-granular(\/.*)?$/,
      ],
      output: {
        chunkFileNames: granularChunkFileNames(),
        assetFileNames: granularAssetFileNames({ components: COMPONENT_NAMES }),
      },
    },
  },
})
