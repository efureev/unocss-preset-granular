import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * Нулевая отметка замера. Обвязка обязана СОВПАДАТЬ с `bench-one` во всём,
 * кроме пресета: только тогда разница дистрибутивов — это цена библиотеки,
 * а не разница сборочных настроек.
 */
export const benchZeroBase = '/bench-zero/'

export const resetChunkGroup = {
  name: 'reset',
  test: /node_modules[\\/]@unocss[\\/]reset[\\/]/,
  priority: 1,
}
export const vueChunkGroup = {
  name: 'vue',
  test: /node_modules[\\/](?:vue|@vue)[\\/]/,
  priority: 3,
}

export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  base: benchZeroBase,
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [resetChunkGroup, vueChunkGroup],
        },
      },
    },
  },
  plugins: [vue()],
})
