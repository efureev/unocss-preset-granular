/// <reference types="vite/client" />

/**
 * Виртуальный модуль плагина `granularThemesPlugin` — манифест тем,
 * собранный из той же резолюции, из которой пресет эмитит CSS.
 */
declare module 'virtual:granular-themes' {
  import type { GranularThemeManifest } from '@feugene/unocss-preset-granular/runtime'

  const manifest: GranularThemeManifest
  export default manifest
}

/**
 * Виртуальный модуль плагина `granularI18nPlugin` — манифест строк из той же
 * резолюции. Тип берётся из `/runtime`, а не из `/node`: это браузерный код,
 * и импорт node-входа ради типа утащил бы `node:fs` в клиентский бандл.
 */
declare module 'virtual:granular-i18n' {
  import type { GranularI18nManifest } from '@feugene/unocss-preset-granular/runtime'

  const manifest: GranularI18nManifest
  export default manifest
}
