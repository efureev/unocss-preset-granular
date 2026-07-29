/**
 * Vite/rolldown build helpers for **granular‑provider packages**.
 *
 * These utilities are used while **building a provider package** (e.g.
 * `@feugene/simple-package`), not by end applications. End apps do NOT need
 * to configure `chunkFileNames`/`assetFileNames` — they consume the
 * already‑built `dist/`.
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

/**
 * Shape of the `assetInfo` argument Vite/rolldown passes to
 * `output.assetFileNames`. Kept structural on purpose — see
 * {@link GranularChunkInfo}.
 */
export interface GranularAssetInfo {
  /** Asset name as computed by the bundler, e.g. `XTest1.css`. */
  name?: string
  /** Source files the asset came from (may be empty for SFC styles). */
  originalFileNames?: readonly string[]
}

/** Options for {@link granularAssetFileNames}. */
export interface GranularAssetFileNamesOptions {
  /**
   * Component names of the package. When given, an asset is routed into a
   * component directory **only** if it belongs to one of these — the exact,
   * recommended mode.
   *
   * Without it the helper falls back to {@link componentAssetRegex}.
   */
  components?: readonly string[]

  /**
   * Regex applied to the asset name when {@link components} is not given.
   * Group 1 must capture the component name.
   *
   * Default: `/^([A-Z][\w-]*)\.css$/` — the usual convention where a
   * component directory (and therefore its style asset) starts with an
   * uppercase letter, so `index.css` of the package entry stays put.
   */
  componentAssetRegex?: RegExp

  /**
   * Pattern for a component's style asset. `<name>` is replaced with the
   * component name.
   *
   * Default: `'components/<name>/styles.css'` — exactly the value
   * `defineGranularComponent` puts into
   * `GranularComponentDescriptor.styleAssetFileName`, and the path the node
   * layer falls back to when reading `cssFiles` from a published package.
   */
  styleAssetPattern?: string

  /**
   * Pattern for everything else (package-level CSS, fonts, images).
   *
   * Default: `'[name][extname]'`.
   */
  fallbackAssetPattern?: string
}

/**
 * Build an `output.assetFileNames` callback that puts a component's style
 * asset where the contract says it lives — `components/<Name>/styles.css`.
 *
 * Why it matters: `defineGranularComponent` fills
 * `styleAssetFileName`/`cssFileAssetNames` with `components/<Name>/…` paths,
 * and the node layer uses them as the **fallback** when reading `cssFiles`
 * from a package that ships only `dist/`. With the default Vite naming the
 * asset lands flat (`dist/XTest1.css`), so that fallback resolves to a file
 * that was never emitted — and the consumer gets a bare `ENOENT`.
 *
 * ```ts
 * import { granularAssetFileNames, granularChunkFileNames } from '@feugene/unocss-preset-granular/vite'
 *
 * const components = ['XTest1', 'XTokenized']
 *
 * export default defineConfig({
 *   build: {
 *     rolldownOptions: {
 *       output: {
 *         chunkFileNames: granularChunkFileNames(),
 *         assetFileNames: granularAssetFileNames({ components }),
 *       },
 *     },
 *   },
 * })
 * ```
 */
export function granularAssetFileNames(
  options: GranularAssetFileNamesOptions = {},
): (assetInfo: GranularAssetInfo) => string {
  const known = options.components ? new Set(options.components) : undefined
  const assetRegex = options.componentAssetRegex ?? /^([A-Z][\w-]*)\.css$/
  const stylePattern = options.styleAssetPattern ?? 'components/<name>/styles.css'
  const fallback = options.fallbackAssetPattern ?? '[name][extname]'

  return (assetInfo) => {
    const name = assetInfo.name
    if (!name)
      return fallback

    // Явный список компонентов — точный режим, без эвристик.
    if (known) {
      const base = name.replace(/\.css$/, '')
      return base !== name && known.has(base)
        ? stylePattern.replace('<name>', base)
        : fallback
    }

    const matched = name.match(assetRegex)
    return matched && matched[1]
      ? stylePattern.replace('<name>', matched[1])
      : fallback
  }
}
