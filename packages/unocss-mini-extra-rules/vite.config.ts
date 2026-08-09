import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

/**
 * Build config for `@feugene/unocss-mini-extra-rules`.
 *
 * — ESM-only (`formats: ['es']`);
 * — all `@unocss/*` packages stay external, but they are declared differently:
 *   `@unocss/core` is a peerDependency (so the consumer's `Rule`/`Preset`
 *   types and the `@unocss/core` instance in their tree stay a single,
 *   consistent version), while `@unocss/preset-mini` and `@unocss/rule-utils`
 *   are plain dependencies — only pure helpers (`h`, `getStringComponents`)
 *   are imported from them, so version identity does not matter there, and as
 *   peers they would fail to resolve under strict `node_modules` layouts
 *   (pnpm, Yarn PnP);
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
