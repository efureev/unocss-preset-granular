import { defineConfig, presetMini } from 'unocss'
import { granularContent, presetGranularNode, type PresetGranularNodeOptions } from '@feugene/unocss-preset-granular/node'
import heavyProvider from '@feugene/heavy-package/granular-provider/node'

/** Ровно один компонент. Его граф разворачивает ещё четыре. */
export const benchOneComponents = ['XhPanel'] as const

export const benchOneOptions: PresetGranularNodeOptions = {
  providers: [heavyProvider],
  components: [
    {
      provider: '@feugene/heavy-package',
      names: [...benchOneComponents],
    },
  ],
  // Обе темы — честный худший случай: приложение, которое умеет переключаться,
  // платит за оба файла.
  themes: { names: ['light', 'dark'] },
  layer: 'granular',
}

export default defineConfig({
  presets: [
    presetMini(),
    presetGranularNode(benchOneOptions),
  ],
  content: granularContent(benchOneOptions),
  /*
   * Трансформеров здесь НЕТ, и это не упущение.
   *
   * `transformerCompileClass` схлопывает классы разметки в один `.uno-<hash>`
   * (в app-1 в CSS лежит именно он) — после этого метрика классов меряет
   * количество хэшей, а не количество утилит. `transformerDirectives` не нужен:
   * в `heavy-package` нет ни одного `@apply`.
   */
})
