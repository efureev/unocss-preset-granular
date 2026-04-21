/**
 * Vite/rolldown build helpers for **granular‑provider packages**.
 *
 * These utilities are used while **building a provider package** (e.g.
 * `@feugene/simple-package`), not by end applications. End apps do NOT need
 * to configure `chunkFileNames` — they consume the already‑built `dist/`.
 *
 * The helpers are pure functions: they do not import Vite, rolldown, node
 * or UnoCSS, so it is safe to import them from a provider's `vite.config.ts`
 * without pulling extra runtime deps.
 */

/**
 * Shape of the `chunkInfo` argument Vite/rolldown passes to
 * `output.chunkFileNames`. We intentionally keep it structural — we don't
 * depend on rolldown/rollup types to keep this module side‑effect free.
 */
export interface GranularChunkInfo {
  moduleIds?: readonly string[]
  name?: string
}

/**
 * Options for {@link granularChunkFileNames}.
 */
export interface GranularChunkFileNamesOptions {
  /**
   * Regex that matches a module id belonging to a component and captures the
   * component directory name in group 1.
   *
   * Default: `/\/src\/components\/([^/]+)\/[^/]+\.vue(?:$|\?)/` — standard
   * provider layout where every component lives in
   * `src/components/<Name>/<Name>.vue`.
   */
  componentModuleRegex?: RegExp

  /**
   * Pattern returned when the chunk contains a component SFC module.
   * `<name>` is replaced with the captured component directory name.
   *
   * Default: `'components/<name>/chunks/[name]-[hash].js'`.
   */
  componentChunkPattern?: string

  /**
   * Pattern returned for chunks that do **not** belong to a component
   * (shared/internal chunks). Use this to avoid moving non‑component chunks
   * (like `granular-provider` or config chunks) into a component folder —
   * doing so would break `packageBaseUrl` resolution.
   *
   * Default: `'chunks/[name]-[hash].js'`.
   */
  fallbackChunkPattern?: string
}

/**
 * Build a `output.chunkFileNames` callback that routes compiled SFC chunks
 * of a component into `components/<Name>/chunks/*.js` — so that UnoCSS
 * (through the granular preset's auto `content.filesystem` globs) can scan
 * exactly the component's own compiled output and pick up utility classes
 * (`p-5`, `text-lg`, …) from its template **without** listing them in
 * `safelist`.
 *
 * Use in a provider package's `vite.config.ts`:
 *
 * ```ts
 * import { defineConfig } from 'vite'
 * import { granularChunkFileNames } from '@feugene/unocss-preset-granular/vite'
 *
 * export default defineConfig({
 *   build: {
 *     rolldownOptions: { // (or rollupOptions)
 *       output: {
 *         chunkFileNames: granularChunkFileNames(),
 *       },
 *     },
 *   },
 * })
 * ```
 *
 * Non‑component chunks (provider entry, shared config) stay flat under
 * `chunks/` so that `packageBaseUrl` resolution is not affected.
 */
export function granularChunkFileNames(
  options: GranularChunkFileNamesOptions = {},
): (chunkInfo: GranularChunkInfo) => string {
  const regex = options.componentModuleRegex
    ?? /\/src\/components\/([^/]+)\/[^/]+\.vue(?:$|\?)/
  const componentPattern = options.componentChunkPattern
    ?? 'components/<name>/chunks/[name]-[hash].js'
  const fallback = options.fallbackChunkPattern
    ?? 'chunks/[name]-[hash].js'

  return (chunkInfo) => {
    const ids = chunkInfo.moduleIds ?? []
    for (const id of ids) {
      const m = id.match(regex)
      if (m && m[1])
        return componentPattern.replace('<name>', m[1])
    }
    return fallback
  }
}
