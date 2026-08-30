/**
 * Высота слоя оверлея — общий модуль ДВУХ компонентов (`XhOverlay` и
 * `XhPanel`), поэтому бандлер выносит его в `dist/chunks/`, вне
 * скан-директорий компонентов.
 *
 * Это и есть воспроизведение живого случая из `@feugene/granularity`
 * (`composables/internal/overlayStack.ts`): имя токена лежит здесь строковым
 * литералом, `var()` собирается из него в рантайме, а сам файл ни в одну
 * скан-директорию не попадает. Канал `source-literal` его не видит — и не
 * может увидеть в принципе.
 *
 * Единственное, что спасает токен от обрезки, — объявление
 * `dynamicTokens` у компонента, который его читает.
 */

/** Слой якорных немодальных панелей. Имя живёт ЗДЕСЬ, вне скана. */
export const DROPDOWN_Z_VAR = '--xh-z-dropdown'

export function layerZIndex(depth = 0, zIndexVar: string = DROPDOWN_Z_VAR): string {
  return depth > 0 ? `calc(var(${zIndexVar}) + ${depth})` : `var(${zIndexVar})`
}
