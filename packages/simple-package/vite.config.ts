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
        'components/XTest1/index': fileURLToPath(
          new URL('./src/components/XTest1/index.ts', import.meta.url),
        ),
        'components/XTestStyled/index': fileURLToPath(
          new URL('./src/components/XTestStyled/index.ts', import.meta.url),
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
        assetFileNames: (assetInfo) => {
          return assetInfo.name ?? '[name][extname]'
        },
      },
    },
  },
})
