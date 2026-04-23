import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

/**
 * Build config for `@feugene/unocss-mini-extra-rules`.
 *
 * — ESM-only (`formats: ['es']`);
 * — all `@unocss/*` packages stay external (declared as peerDependencies);
 * — declarations are emitted separately via `vue-tsc -p tsconfig.build.json`
 *   (see `package.json` scripts).
 */
export default defineConfig({
  build: {
    target: 'esnext',
    minify: 'oxc',
    reportCompressedSize: true,
    emptyOutDir: true,
    lib: {
      entry: {
        index: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rolldownOptions: {
      external: [
        /^node:/,
        /^@unocss\//,
        'unocss',
      ],
      output: {
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
})
