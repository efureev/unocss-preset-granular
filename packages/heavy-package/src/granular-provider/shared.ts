// `id`, `theme.*`, `packageBaseUrl` и реестр компонентов провайдера.
//
// Модуль намеренно НЕ является entry: его импортируют оба entry (`index.ts` и
// `node.ts`), поэтому бандлер обязан вынести его в общий чанк
// `dist/chunks/*.js`. От этого зависит `packageBaseUrl`: `resolvePackageBaseUrl`
// считает базу от места, куда ЭТОТ модуль положил бандлер, и `levelsUp = 1`
// верен ровно для `<base>/chunks/`. Собранный в entry (`dist/granular-provider.js`)
// тот же код дал бы базой корень пакета — скан пустеет, CSS компонентов
// исчезает, ошибки нет.
//
// Все `new URL('../theme/...', import.meta.url)` обязаны лежать тоже здесь:
// `index.ts` и `node.ts` — соседи по директории, поэтому относительные пути
// совпадают при любом из них.
import {
  defineGranularProvider,
  type GranularComponentDescriptor,
  type GranularProvider,
  resolvePackageBaseUrl,
} from '@feugene/unocss-preset-granular/contract'

import { xhAlertConfig } from '../components/XhAlert/config'
import { xhButtonConfig } from '../components/XhButton/config'
import { xhCardConfig } from '../components/XhCard/config'
import { xhListConfig } from '../components/data/XhList/config'
import { xhOverlayConfig } from '../components/XhOverlay/config'
import { xhPanelConfig } from '../components/XhPanel/config'
import { xhTableConfig } from '../components/data/XhTable/config'

export const HEAVY_PROVIDER_ID = '@feugene/heavy-package'

/**
 * Базовый URL пакета. `resolvePackageBaseUrl`, а не литерал
 * `new URL('..', import.meta.url)`: последний rolldown заменяет на `data:`-URL,
 * и скан-директории схлопываются в ничто.
 */
export const PACKAGE_BASE_URL = resolvePackageBaseUrl(import.meta.url)

/**
 * Единственный в репозитории провайдер с ПАКЕТНЫМ фундаментом.
 *
 * Все четыре ссылки обязаны быть литералами `new URL(..., import.meta.url)`:
 * у `baseCssUrl`/`tokensCssUrl`/`themes[name]` нет фолбэка по `assetName`
 * (в отличие от `cssFiles` и компонентного `tokenDefinitionsRef`), поэтому
 * строкой их объявить нельзя — node-слой упрётся в ENOENT у опубликованного
 * пакета. Цена литерала: бандлер инлайнит содержимое как `data:text/css`
 * в `dist/granular-provider.js`. Здесь это допустимо только потому, что этот
 * entry не попадает в клиентский бандл. Для настоящей дизайн-системы это
 * компромисс, который надо взвешивать отдельно.
 */
const theme = {
  baseCssUrl: new URL('../theme/base.css', import.meta.url).href,
  tokensCssUrl: new URL('../theme/tokens.css', import.meta.url).href,
  themes: {
    light: new URL('../theme/light.css', import.meta.url).href,
    dark: new URL('../theme/dark.css', import.meta.url).href,
  },
  defaultThemes: ['light'],
} as const

/** Реестр компонентов пакета в порядке объявления. */
export const heavyComponentConfigs = {
  XhCard: xhCardConfig,
  XhButton: xhButtonConfig,
  XhAlert: xhAlertConfig,
  XhOverlay: xhOverlayConfig,
  XhPanel: xhPanelConfig,
  XhTable: xhTableConfig,
  XhList: xhListConfig,
}

export type HeavyComponentName = keyof typeof heavyComponentConfigs

const baseComponents: readonly GranularComponentDescriptor[] = Object.values(heavyComponentConfigs)

export function createHeavyProvider(
  components: readonly GranularComponentDescriptor[] = baseComponents,
): GranularProvider {
  return defineGranularProvider({
    id: HEAVY_PROVIDER_ID,
    contractVersion: 1,
    packageBaseUrl: PACKAGE_BASE_URL,
    components,
    theme,
  })
}

