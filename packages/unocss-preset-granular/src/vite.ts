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
   * Regex that matches a module id belonging to a **shared SFC** of a
   * component group and captures the **group path** in group 1.
   *
   * A "shared SFC" is a Vue component imported by ≥ 2 entry-components of
   * the same group (e.g. `transaction-details/shared/TransactionModalHeader.vue`
   * imported by `FtExpenseModal`, `FtIncomeModal`, `FtTransferModal`).
   *
   * Default: `/\/src\/components\/(.+)\/shared\/[^/]+\.vue(?:$|\?)/` —
   * standard layout `src/components/<group>/shared/<File>.vue`.
   */
  sharedModuleRegex?: RegExp

  /**
   * Pattern returned when the chunk contains a shared SFC module of a group.
   * `<group>` is replaced with the captured group path.
   *
   * Default: `'groups/<group>/shared/[name]-[hash].js'`.
   *
   * The end app's preset, given a component descriptor with `group: '<group>'`,
   * will additionally scan `dist/groups/<group>/shared/` — and pick up
   * utility classes from these chunks.
   */
  sharedChunkPattern?: string

  /**
   * Pattern returned for chunks that do **not** belong to a component
   * or a shared SFC of a group (e.g. `granular-provider`, `i18n`,
   * `config`). These remain flat under `chunks/` so that `packageBaseUrl`
   * resolution is not affected.
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
  const componentRegex = options.componentModuleRegex
    ?? /\/src\/components\/([^/]+)\/[^/]+\.vue(?:$|\?)/
  const sharedRegex = options.sharedModuleRegex
    ?? /\/src\/components\/(.+)\/shared\/[^/]+\.vue(?:$|\?)/
  const componentPattern = options.componentChunkPattern
    ?? 'components/<name>/chunks/[name]-[hash].js'
  const sharedPattern = options.sharedChunkPattern
    ?? 'groups/<group>/shared/[name]-[hash].js'
  const fallback = options.fallbackChunkPattern
    ?? 'chunks/[name]-[hash].js'

  return (chunkInfo) => {
    const ids = chunkInfo.moduleIds ?? []
    // Shared SFC takes precedence: a chunk can contain a module that
    // matches both regexes (e.g. group path captured by component regex
    // would yield wrong directory like `transaction-details`); checking
    // shared first guarantees correct routing.
    for (const id of ids) {
      const m = id.match(sharedRegex)
      if (m && m[1])
        return sharedPattern.replace('<group>', m[1])
    }
    for (const id of ids) {
      const m = id.match(componentRegex)
      if (m && m[1])
        return componentPattern.replace('<name>', m[1])
    }
    return fallback
  }
}
