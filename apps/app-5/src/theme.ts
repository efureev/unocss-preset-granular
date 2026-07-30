import manifest from 'virtual:granular-themes'
import {createThemeController} from '@feugene/unocss-preset-granular/runtime'

/**
 * Один контроллер на приложение.
 *
 * Создаётся ДО монтирования Vue (см. main.ts): применение темы синхронное,
 * так что первый кадр рисуется уже в нужной теме — без вспышки чужих цветов.
 */
export const themes = createThemeController(manifest)
