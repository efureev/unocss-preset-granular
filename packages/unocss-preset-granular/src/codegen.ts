/**
 * Генерация реестров компонентов для пакета-провайдера.
 *
 * Провайдер перечисляет свои компоненты в нескольких местах: root-barrel,
 * subpath-экспорты, entry сборки, реестр самого провайдера, а у companion —
 * ещё whitelist резолвера авто-импорта и список для `granularAssetFileNames`.
 * Пропуск любого не даёт ошибки сборки: ломается что-то одно и молча.
 *
 * Модуль работает с файлами и потому доступен только из Node — как `./node`
 * и `./vite`.
 *
 * @example
 * ```js
 * // scripts/generate-registry.mjs
 * import { fileURLToPath } from 'node:url'
 * import { codegenTargets, runRegistryCodegen } from '@feugene/unocss-preset-granular/codegen'
 *
 * const { components, stale } = await runRegistryCodegen({
 *   packageDir: fileURLToPath(new URL('..', import.meta.url)),
 *   check: process.argv.includes('--check'),
 *   targets: [
 *     codegenTargets.barrel(),
 *     codegenTargets.viteEntries(),
 *     codegenTargets.packageExports(),
 *     ...codegenTargets.providerRegistry(),
 *   ],
 * })
 * ```
 */

import { barrel, markedBlock, packageExports, providerRegistry, viteEntries } from './codegen/targets'

export { replaceMarkedBlock, replacePackageExports } from './codegen/blocks'
export type { ReplaceMarkedBlockOptions, ReplacePackageExportsOptions } from './codegen/blocks'

export {
  collectGranularComponentEntries,
  collectGranularComponents,
  compareComponentNames,
  defaultConfigExportName,
} from './codegen/collectComponents'
export type { CollectComponentsOptions, GranularComponentEntry } from './codegen/collectComponents'

export { GranularCodegenError } from './codegen/errors'
export type { GranularCodegenReason } from './codegen/errors'

export { runRegistryCodegen } from './codegen/runRegistryCodegen'
export type { RegistryCodegenResult, RunRegistryCodegenOptions } from './codegen/runRegistryCodegen'

export {
  collectGranularSubcomponents,
  parseSubcomponents,
} from './codegen/subcomponents'
export type { CollectSubcomponentsOptions } from './codegen/subcomponents'

export type { GranularCodegenContext, GranularCodegenTarget } from './codegen/targets'

/**
 * Готовые цели. Собраны в объект, а не разложены плоскими экспортами: имена
 * вроде `barrel` слишком общие для публичной поверхности пакета.
 */
export const codegenTargets = {
  barrel,
  viteEntries,
  packageExports,
  providerRegistry,
  markedBlock,
} as const
