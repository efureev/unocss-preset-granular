import { fileURLToPath, URL } from 'node:url'
import { defineConfig, presetMini } from 'unocss'
import { granularContent, presetGranularNode, type PresetGranularNodeOptions } from '@feugene/unocss-preset-granular/node'
import heavyProvider from '@feugene/heavy-package/granular-provider/node'

/** Ровно один компонент. Его граф разворачивает ещё четыре. */
export const benchPrunedComponents = ['XhPanel'] as const

export const benchPrunedOptions: PresetGranularNodeOptions = {
  providers: [heavyProvider],
  components: [
    {
      provider: '@feugene/heavy-package',
      names: [...benchPrunedComponents],
    },
  ],
  // Обе темы — честный худший случай: приложение, которое умеет переключаться,
  // платит за оба файла.
  themes: { names: ['light', 'dark'] },
  layer: 'granular',
  /*
   * Единственное отличие от `bench-one`.
   *
   * `appSources` обязателен, а не желателен: пресет видит компоненты
   * провайдера и НЕ видит разметку приложения. Здесь она без утилит, но
   * включать обрезку в настоящем приложении без этой строки нельзя — токен,
   * который приложение взяло само, уедет из CSS при зелёной сборке.
   */
  pruneTokens: {
    mode: 'on',
    appSources: { dirs: [fileURLToPath(new URL('./src', import.meta.url))] },
  },
}

export default defineConfig({
  presets: [
    presetMini(),
    presetGranularNode(benchPrunedOptions),
  ],
  content: granularContent(benchPrunedOptions),
  /*
   * Трансформеров здесь НЕТ, и это не упущение.
   *
   * `transformerCompileClass` схлопывает классы разметки в один `.uno-<hash>`
   * (в app-1 в CSS лежит именно он) — после этого метрика классов меряет
   * количество хэшей, а не количество утилит. `transformerDirectives` не нужен:
   * в `heavy-package` нет ни одного `@apply`.
   */
})
