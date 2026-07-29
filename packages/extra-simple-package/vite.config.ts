import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { granularAssetFileNames, granularChunkFileNames } from '@feugene/unocss-preset-granular/vite'

/** Имена granular-компонентов пакета. */
const COMPONENT_NAMES = ['XgQuick', 'XTokenizedLevel2']

export default defineConfig({
  plugins: [vue()],
  build: {
    target: 'esnext',
    minify: 'oxc',
    reportCompressedSize: true,
    emptyOutDir: true,
    // Каждому компоненту — свой CSS-ассет, иначе на выходе один общий файл
    // пакета, который нельзя честно назвать `components/<Name>/styles.css`.
    cssCodeSplit: true,
    lib: {
      entry: {
        index: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        'components/XgQuick/index': fileURLToPath(
          new URL('./src/components/XgQuick/index.ts', import.meta.url),
        ),
        'components/XTokenizedLevel2/index': fileURLToPath(
          new URL('./src/components/XTokenizedLevel2/index.ts', import.meta.url),
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
        /^@feugene\/simple-package(\/.*)?$/,
        /^@feugene\/unocss-preset-granular(\/.*)?$/,
      ],
      output: {
        /**
         * Чанки со скомпилированными SFC размещаем в `components/<Name>/chunks/`,
         * чтобы UnoCSS мог просканировать исходники конкретного компонента
         * (через авто‑`content.filesystem` `presetGranularNode`) и вытащить
         * утилитарные классы из шаблона (`p-5` и т.п.) — не трогая чужие
         * компоненты пакета. Логика вынесена в хелпер `granularChunkFileNames`
         * пакета‑пресета (переносятся только чанки, содержащие `*.vue`
         * компонента; `granular-provider`/config‑чанки остаются во flat
         * `chunks/`, иначе сломается `packageBaseUrl`).
         */
        chunkFileNames: granularChunkFileNames(),
        /**
         * CSS компонентов — в `components/<Name>/styles.css`, как объявляет
         * `styleAssetFileName` дескриптора. Раньше тут стоял рукописный
         * маппинг, который отправлял ЛЮБОЙ css-ассет в `XgQuick` — с
         * появлением второго компонента со стилями он бы их склеил.
         */
        assetFileNames: granularAssetFileNames({ components: COMPONENT_NAMES }),
      },
    },
  },
})
