import manifest from 'virtual:granular-themes'
import {createThemeController} from '@feugene/unocss-preset-granular/runtime'

/**
 * Контроллер тем приложения.
 *
 * Тем `light`/`dark` в сборке нет, поэтому `initial: 'auto'` опирается не на
 * имена, а на `colorScheme` из манифеста: системная тёмная схема даст первую
 * тему с `colorScheme: 'dark'` (здесь — `emerald`), светлая — `ocean`.
 */
export const themes = createThemeController(manifest)

/** Подпись темы для UI: `label` из конфига, иначе — само имя. */
export function themeLabel(name: string): string {
    return themes.entry(name).label ?? name
}
