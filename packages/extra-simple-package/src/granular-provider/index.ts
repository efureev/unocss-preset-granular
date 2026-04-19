import { defineGranularProvider, type GranularProvider } from '@feugene/unocss-preset-granular/contract'
import simpleProvider from '@feugene/simple-package/granular-provider/node'

import { xgQuickConfig } from '../components/XgQuick/config'

export const EXTRA_SIMPLE_PROVIDER_ID = '@feugene/extra-simple-package'

/**
 * Granular‑provider пакета `@feugene/extra-simple-package`.
 *
 * Самодостаточен: декларирует зависимость на донора `@feugene/simple-package`
 * через `GranularProvider.dependencies`, поэтому приложению достаточно
 * добавить только этот провайдер в `presetGranularNode({ providers: [...] })` —
 * ядро пресета транзитивно развернёт донор(-ов) и соберёт CSS/темы с них тоже.
 *
 * ```ts
 * presetGranularNode({
 *   providers: [extraSimpleProvider], // simple-package подтянется автоматически
 *   components: ['@feugene/extra-simple-package:XgQuick'],
 * })
 * ```
 *
 * Композитные компоненты, как и раньше, декларируют свои зависимости на
 * компоненты донора через `component.dependencies` в `config.ts`.
 */
export const extraGranularityProvider: GranularProvider = defineGranularProvider({
  id: EXTRA_SIMPLE_PROVIDER_ID,
  contractVersion: 1,
  packageBaseUrl: `${import.meta.url.slice(0, import.meta.url.lastIndexOf('/', import.meta.url.lastIndexOf('/') - 1) + 1)}`,
  components: [xgQuickConfig],
  dependencies: [simpleProvider],
})

export default extraGranularityProvider
