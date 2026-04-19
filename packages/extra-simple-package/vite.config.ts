import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

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
         * компоненты пакета.
         */
        chunkFileNames: (chunkInfo: { moduleIds?: readonly string[], name?: string }) => {
          // Триггерим перенос ТОЛЬКО для чанков, в модулях которых есть SFC
          // (`*.vue`) конкретного компонента. Иначе granular-provider / config-чанк
          // случайно переместился бы вместе с ним и сломал бы `packageBaseUrl`.
          const ids = chunkInfo.moduleIds ?? []
          for (const id of ids) {
            const m = id.match(/\/src\/components\/([^/]+)\/[^/]+\.vue(?:$|\?)/)
            if (m)
              return `components/${m[1]}/chunks/[name]-[hash].js`
          }
          return 'chunks/[name]-[hash].js'
        },
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
