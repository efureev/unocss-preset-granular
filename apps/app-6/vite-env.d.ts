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
