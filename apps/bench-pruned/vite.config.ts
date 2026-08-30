import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import {
  getGranularComponentCssFiles,
  resolveGranularFilesystemGlobs,
  resolveGranularNode,
} from '@feugene/unocss-preset-granular/node'

import { benchPrunedOptions } from './uno.config'

/**
 * Тот же стенд, что `bench-one`, с одним отличием: обрезка токенов включена.
 * Пара `bench-one` → `bench-pruned` и есть измерение эффекта обрезки; всё
 * остальное в обеих сборках обязано совпадать до байта.
 */
export const benchPrunedBase = '/bench-pruned/'
export const heavyPkgDistDir = fileURLToPath(new URL('../../packages/heavy-package/dist/', import.meta.url))

export const resetChunkGroup = {
  name: 'reset',
  test: /node_modules[\\/]@unocss[\\/]reset[\\/]/,
  priority: 1,
}
export const heavyPkgChunkGroup = {
  name: 'hpkg',
  test: (id: string) => id.startsWith(heavyPkgDistDir),
  priority: 2,
}
export const vueChunkGroup = {
  name: 'vue',
  test: /node_modules[\\/](?:vue|@vue)[\\/]/,
  priority: 3,
}

/**
 * Паспорт сборки для измерителя: что пресет ЗНАЕТ про компоненты.
 *
 * Считается из ТОЙ ЖЕ резолюции, что питает пресет (`resolveGranularNode` на
 * том же объекте опций), — иначе знаменатель метрики safelist описывал бы не
 * тот CSS, который лежит рядом. Тот же инвариант, по которому построен
 * `granularThemesPlugin`.
 *
 * Плагин живёт здесь, а не в пресете: пресету незачем растить build-time
 * отчётность ради двух стендов.
 *
 * Файл ложится в `dist/`, а НЕ в `dist/assets/` — иначе он попал бы в корпус
 * `verify-apps.mjs` и начал бы удовлетворять его подстрочные проверки сам.
 */
function benchMetaPlugin() {
  return {
    name: 'bench-meta',
    async generateBundle(this: { emitFile: (f: { type: 'asset', fileName: string, source: string }) => void }) {
      const resolution = resolveGranularNode(benchPrunedOptions)
      const meta = {
        granular: true,
        components: [...resolution.resolved.order],
        themes: [...resolution.themes.names],
        safelist: [...resolution.safelist],
        safelistByComponent: Object.fromEntries(
          resolution.resolved.entries.map(entry => [
            `${entry.provider.id}:${entry.descriptor.name}`,
            [...(entry.descriptor.safelist ?? [])],
          ]),
        ),
        scanGlobs: resolveGranularFilesystemGlobs(benchPrunedOptions),
        componentCssFiles: await getGranularComponentCssFiles(benchPrunedOptions),
      }
      this.emitFile({ type: 'asset', fileName: 'bench-meta.json', source: `${JSON.stringify(meta, null, 2)}\n` })
    },
  }
}

export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  base: benchPrunedBase,
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [resetChunkGroup, heavyPkgChunkGroup, vueChunkGroup],
        },
      },
    },
  },
  plugins: [
    vue(),
    UnoCSS({
      configFile: fileURLToPath(new URL('./uno.config.ts', import.meta.url)),
    }),
    benchMetaPlugin(),
  ],
})
