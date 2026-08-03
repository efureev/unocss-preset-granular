import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { libInjectCss } from 'vite-plugin-lib-inject-css'
import { granularAssetFileNames, granularChunkFileNames, granularCssAssetsPlugin } from '@feugene/unocss-preset-granular/vite'
import { xTokenizedConfig } from './src/components/XTokenized/config'
/** Имена granular-компонентов пакета — источник правды для entry и ассетов. */
const COMPONENT_NAMES = [
  'XTest1',
  'XTestStyled',
  'XTokenized',
  'XNested',
  'XNestedReverse',
  'XGroupAOne',
  'XGroupATwo',
]

export default defineConfig({
  plugins: [
    vue(),
    libInjectCss(),
    // XTokenized объявляет тему `dark` СТРОКОЙ — бандлер про такую ссылку
    // ничего не знает и файл в `dist` не положит. Плагин кладёт его по
    // `assetName`, то есть ровно туда, куда смотрит фолбэк node-слоя.
    granularCssAssetsPlugin({ components: [xTokenizedConfig] }),
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
        'components/XTest1/index': fileURLToPath(
          new URL('./src/components/XTest1/index.ts', import.meta.url),
        ),
        'components/XTestStyled/index': fileURLToPath(
          new URL('./src/components/XTestStyled/index.ts', import.meta.url),
        ),
        'components/XTokenized/index': fileURLToPath(
          new URL('./src/components/XTokenized/index.ts', import.meta.url),
        ),
        'components/XNested/index': fileURLToPath(
          new URL('./src/components/XNested/index.ts', import.meta.url),
        ),
        'components/XNestedReverse/index': fileURLToPath(
          new URL('./src/components/reverses/XNestedReverse/index.ts', import.meta.url),
        ),
        // groupA — фикстура для проверки контракта group-shared:
        // оба entry-компонента импортируют общий SFC `groupA/shared/...`,
        // build кладёт shared-чанк в `dist/groups/groupA/shared/`.
        'components/XGroupAOne/index': fileURLToPath(
          new URL('./src/components/groupA/XGroupAOne/index.ts', import.meta.url),
        ),
        'components/XGroupATwo/index': fileURLToPath(
          new URL('./src/components/groupA/XGroupATwo/index.ts', import.meta.url),
        ),
        'granular-provider': fileURLToPath(
          new URL('./src/granular-provider/index.ts', import.meta.url),
        ),
        'granular-provider-node': fileURLToPath(
          new URL('./src/granular-provider/node.ts', import.meta.url),
        ),
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
        /**
         * Чанки со скомпилированными SFC размещаем в `components/<Name>/chunks/`,
         * чтобы UnoCSS мог просканировать исходники конкретного компонента
         * (через авто‑`content.filesystem` `presetGranularNode`) и вытащить
         * утилитарные классы из шаблона — не трогая чужие компоненты пакета.
         * Логика вынесена в хелпер `granularChunkFileNames` пакета‑пресета.
         */
        chunkFileNames: granularChunkFileNames(),
        /**
         * CSS компонента кладём туда, где его ждёт контракт —
         * `components/<Name>/styles.css` (это же значение
         * `defineGranularComponent` пишет в `styleAssetFileName`, и по нему
         * node-слой пресета ищет CSS, когда пакет опубликован без исходников).
         * По умолчанию Vite положил бы его плоско — `dist/XTest1.css`.
         */
        assetFileNames: granularAssetFileNames({ components: COMPONENT_NAMES }),
      },
    },
  },
})
