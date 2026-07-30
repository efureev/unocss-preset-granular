/**
 * Рантайм-слой: переключение тем в браузере.
 *
 * Отдельный entry, а не часть `.`, намеренно — чтобы клиентский бандл не тянул
 * ничего из ядра пресета. Здесь только типы, чистый парсер селекторов и
 * контроллер над DOM: ни FS, ни UnoCSS, ни зависимостей вообще.
 *
 * Пара к нему — `getGranularThemeManifest` / `granularThemesPlugin` из
 * `@feugene/unocss-preset-granular/node`: они собирают манифест на этапе
 * сборки из той же резолюции, из которой эмитится CSS.
 */
export {
  createThemeController,
  type GranularThemeController,
  type GranularThemeControllerOptions,
  type GranularThemeStorage,
  type GranularThemeTarget,
} from './runtime/controller'

export {
  type GranularThemeActivation,
  type GranularThemeEntry,
  type GranularThemeManifest,
  resolveThemeActivation,
  splitSelectorList,
} from './runtime/manifest'
