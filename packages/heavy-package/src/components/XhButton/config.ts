import { defineGranularComponent } from '@feugene/unocss-preset-granular/contract'

import { splitClassTokens } from '../../utils/classTokens'
import { BASE_CLASS, PAD_STEP, TONE } from './btnStyles'

export const xhButtonConfig = defineGranularComponent(import.meta.url, {
  name: 'XhButton',
  safelist: [
    ...splitClassTokens(BASE_CLASS),
    ...Object.values(PAD_STEP).map(step => `p-${step}`),
    ...Object.values(TONE).flatMap(splitClassTokens),
    // НАМЕРЕННЫЙ дефект фикстуры: правила `shadow-legacy` UnoCSS не породит,
    // селектор в дистрибутиве не появится. Единственный вердикт метрики,
    // у которого нет оговорок, — и единственный её пример. Удалять нельзя:
    // без него детектор мёртвых записей ничем не проверяется.
    'shadow-legacy',
  ],
})
