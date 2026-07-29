import { defineGranularProvider, type GranularProvider } from '@feugene/unocss-preset-granular/contract'
// БРАУЗЕРНЫЙ entry донора: `/node` отсюда тянуть нельзя — этот модуль и есть
// браузерный экспорт `./granular-provider`, и node-слой уехал бы в клиент
// транзитивно. Node-вариант донора подставляет `./node.ts`.
import simpleProvider from '@feugene/simple-package/granular-provider'

import { xgQuickConfig } from '../components/XgQuick/config'
import { xTokenizedLevel2Config } from '../components/XTokenizedLevel2/config'

export const EXTRA_SIMPLE_PROVIDER_ID = '@feugene/extra-simple-package'

export const PACKAGE_BASE_URL = `${import.meta.url.slice(0, import.meta.url.lastIndexOf('/', import.meta.url.lastIndexOf('/') - 1) + 1)}`

/**
 * Фабрика провайдера: донор передаётся аргументом, потому что у него два
 * варианта — браузерный (этот модуль) и node (`./node.ts`, с токенами тем,
 * вычитанными из CSS).
 */
export function createExtraProvider(donor: GranularProvider): GranularProvider {
  return defineGranularProvider({
    id: EXTRA_SIMPLE_PROVIDER_ID,
    contractVersion: 1,
    packageBaseUrl: PACKAGE_BASE_URL,
    components: [xgQuickConfig, xTokenizedLevel2Config],
    dependencies: [donor],
  })
}

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
export const extraGranularityProvider: GranularProvider = createExtraProvider(simpleProvider)

export default extraGranularityProvider
