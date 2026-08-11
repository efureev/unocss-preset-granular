import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// ВНИМАНИЕ: пакет публикуется ИЗ КОРНЯ каталога (`npm publish` в
// `packages/unocss-preset-granular`, `files: ["dist"]`), а не из `dist/`.
// Поэтому здесь НЕ генерируется `dist/package.json`: вложенный манифест
// с полем `exports` Node игнорирует, а часть бандлеров всё-таки читает —
// получая другую карту резолва (см. `publint`).

const SHEBANG = '#!/usr/bin/env node'

export default defineConfig({
  plugins: [
    {
      // Гарантируем шебанг у CLI-энтрипоинта bin.js (бандлер может его срезать).
      name: 'unocss-preset-granular:bin-shebang',
      apply: 'build',
      generateBundle(_options, bundle) {
        const chunk = bundle['bin.js']
        if (chunk && chunk.type === 'chunk' && !chunk.code.startsWith(SHEBANG))
          chunk.code = `${SHEBANG}\n${chunk.code}`
      },
    },
  ],
  build: {
    target: 'esnext',
    reportCompressedSize: true,
    minify: false,
    lib: {
      entry: {
        index: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        node: fileURLToPath(new URL('./src/node.ts', import.meta.url)),
        contract: fileURLToPath(new URL('./src/contract/index.ts', import.meta.url)),
        vite: fileURLToPath(new URL('./src/vite.ts', import.meta.url)),
        runtime: fileURLToPath(new URL('./src/runtime.ts', import.meta.url)),
        codegen: fileURLToPath(new URL('./src/codegen.ts', import.meta.url)),
        bin: fileURLToPath(new URL('./src/bin.ts', import.meta.url)),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rolldownOptions: {
      external: [
        'node:buffer',
        'node:fs',
        'node:fs/promises',
        'node:path',
        'node:process',
        'node:url',
        'unocss',
        'magic-string',
        '@unocss/core',
        // Рантайм-зависимость, а не вендоринг. Без этой строки rolldown инлайнит
        // сам пакет и вместе с ним куски его peer'ов (`@unocss/preset-mini`,
        // `@unocss/rule-utils`): чанк пресета раздувается с ~40 до ~92 КБ ради
        // ~10 КБ правил, а потребитель всё равно ставит npm-копию из
        // `dependencies` — и она остаётся неиспользованной.
        '@feugene/unocss-mini-extra-rules',
      ],
    },
  },
})
