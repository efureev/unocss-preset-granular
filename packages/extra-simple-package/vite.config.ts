import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { granularChunkFileNames } from '@feugene/unocss-preset-granular/vite'

export default defineConfig({
  plugins: [vue()],
  build: {
    target: 'esnext',
    minify: 'oxc',
    reportCompressedSize: true,
    emptyOutDir: true,
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
        assetFileNames: (assetInfo) => {
          // Vite names the combined library CSS after the package ("extra-granularity.css").
          // Rename it to match the package.json export `./components/XgQuickForm/styles.css`.
          if (assetInfo.name?.endsWith('.css'))
            return 'components/XgQuick/styles.css'

          return assetInfo.name ?? '[name][extname]'
        },
      },
    },
  },
})
