import type { PresetGranularResolution } from '../preset'
import { existsSync, realpathSync, statSync } from 'node:fs'

import { fileURLToPath } from 'node:url'
import { createDebug } from '../core/debug'

const debugScan = createDebug('granular:scan')

/** Описание директории-источника для UnoCSS `content.filesystem`. */
export interface ResolvedScanDir {
  providerId: string
  componentName: string
  /** Абсолютный путь к директории (после realpath). */
  dir: string
  /**
   * Тип директории:
   *  - `'component'` — `<packageBaseUrl>/components/<Name>/` (per-component output);
   *  - `'group-shared'` — `<packageBaseUrl>/groups/<group>/shared/` (shared SFC группы).
   */
  kind: 'component' | 'group-shared'
}

/** Компонент, который в скан НЕ попал, и причина. */
export interface SkippedScanDir {
  providerId: string
  componentName: string
  /** Путь, который ожидался по layout-контракту (или его шаблон). */
  expectedDir: string
  reason: 'missing-dir' | 'missing-entry' | 'invalid-base-url'
}

/**
 * Полный результат инспекции: что уйдёт в скан и что отвалилось.
 *
 * Один результат на двух потребителей — `granularContent`/`presetGranularNode`
 * (берут `dirs`) и `granular doctor` (показывает и `dirs`, и `skipped`).
 * Раньше doctor имел собственную копию обхода и расходился с реальностью.
 */
export interface ScanDirsInspection {
  dirs: ResolvedScanDir[]
  skipped: SkippedScanDir[]
}

/** Опции резолва директорий сканирования. */
export interface ResolveScanDirsOptions {
  /**
   * Строгий режим. Если `true` — отсутствие `dist/components/<Name>/` или
   * `index.js` внутри неё бросает `GranularProviderContractError`.
   * Если `false` — печатается `console.warn` и компонент пропускается
   * (его собственный `safelist`/`cssFiles` всё равно подключатся отдельным
   * каналом). По умолчанию `false`.
   */
  strict?: boolean
}

/** Ошибка нарушения контракта layout пакета-провайдера. */
export class GranularProviderContractError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly componentName: string,
    public readonly expectedDir: string,
    public readonly reason: 'missing-dir' | 'missing-entry',
  ) {
    const what = reason === 'missing-dir'
      ? `directory '${expectedDir}' does not exist`
      : `entry 'index.js' is missing in '${expectedDir}'`
    super(
      `Granular provider '${providerId}' violates layout contract for component '${componentName}': ${what}. `
      + `Each granular component MUST be emitted under '<packageBaseUrl>/components/<Name>/' with at least an 'index.js'. `
      + `Use 'granularChunkFileNames()' from '@feugene/unocss-preset-granular/vite' in your provider's bundler config.`,
    )
    this.name = 'GranularProviderContractError'
  }
}

function isExistingDir(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory()
  }
  catch {
    return false
  }
}

function isExistingFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile()
  }
  catch {
    return false
  }
}

function canonicalize(path: string): string {
  try {
    return realpathSync(path)
  }
  catch {
    return path
  }
}

/**
 * Для каждой резолвнутой entry возвращает ОДНУ директорию исходников —
 * `<provider.packageBaseUrl>/components/<descriptor.name>/`. Это и есть
 * жёсткий контракт публикации granular-компонентов: бандлер провайдера
 * (см. `granularChunkFileNames()` в `@feugene/unocss-preset-granular/vite`)
 * обязан раскладывать все артефакты компонента под этот путь.
 *
 * - Если директория отсутствует или внутри нет `index.js` — в `strict: true`
 *   бросается {@link GranularProviderContractError}, иначе печатается
 *   `console.warn` и компонент пропускается.
 * - Результат дедуплицируется по каноническому `realpath`, чтобы symlink
 *   из `node_modules` в `packages/...` не дублировал скан.
 */
export function resolveComponentScanDirs(
  resolution: PresetGranularResolution,
  options: ResolveScanDirsOptions = {},
): ScanDirsInspection {
  const strict = options.strict === true
  const result: ResolvedScanDir[] = []
  const skipped: SkippedScanDir[] = []
  const seen = new Set<string>()

  for (const { provider, descriptor } of resolution.resolved.entries) {
    let dir: string
    try {
      dir = fileURLToPath(new URL(`components/${descriptor.name}/`, provider.packageBaseUrl))
    }
    catch {
      if (strict) {
        throw new GranularProviderContractError(
          provider.id,
          descriptor.name,
          `<packageBaseUrl>/components/${descriptor.name}/`,
          'missing-dir',
        )
      }
      console.warn(
        `[granular] cannot resolve scan dir for '${provider.id}:${descriptor.name}': `
        + `invalid 'packageBaseUrl' (${provider.packageBaseUrl}). Skipping component scan.`,
      )
      skipped.push({
        providerId: provider.id,
        componentName: descriptor.name,
        expectedDir: `<packageBaseUrl>/components/${descriptor.name}/`,
        reason: 'invalid-base-url',
      })
      continue
    }

    if (!isExistingDir(dir)) {
      if (strict)
        throw new GranularProviderContractError(provider.id, descriptor.name, dir, 'missing-dir')
      console.warn(
        `[granular] component '${provider.id}:${descriptor.name}' has no 'components/${descriptor.name}/' `
        + `directory at '${dir}'. Skipping scan. Configure your provider build to emit per-component output `
        + `(see 'granularChunkFileNames()' from '@feugene/unocss-preset-granular/vite').`,
      )
      skipped.push({ providerId: provider.id, componentName: descriptor.name, expectedDir: dir, reason: 'missing-dir' })
      continue
    }

    if (!isExistingFile(`${dir}index.js`)) {
      if (strict)
        throw new GranularProviderContractError(provider.id, descriptor.name, dir, 'missing-entry')
      console.warn(
        `[granular] component '${provider.id}:${descriptor.name}' is missing 'index.js' at '${dir}'. `
        + `Skipping scan — the component bundle was not emitted.`,
      )
      skipped.push({ providerId: provider.id, componentName: descriptor.name, expectedDir: dir, reason: 'missing-entry' })
      continue
    }

    const canonical = canonicalize(dir)
    if (seen.has(canonical))
      continue
    seen.add(canonical)

    result.push({
      providerId: provider.id,
      componentName: descriptor.name,
      dir: canonical,
      kind: 'component',
    })

    // Shared directory for component group (optional, opt-in via `group`).
    // Contract: `<packageBaseUrl>/groups/<group>/shared/` — emitted by
    // provider's bundler via `granularChunkFileNames()` when ≥ 2 entry
    // components of the same group import a common SFC. Missing dir is
    // tolerated (no warn, no throw): a group with no shared SFC simply
    // produces no `groups/<group>/shared/` folder.
    const group = descriptor.group
    if (typeof group !== 'string' || group.length === 0)
      continue

    let sharedDir: string
    try {
      sharedDir = fileURLToPath(new URL(`groups/${group}/shared/`, provider.packageBaseUrl))
    }
    catch {
      // Invalid packageBaseUrl is already reported above for the
      // component itself; do not double-report.
      continue
    }

    if (!isExistingDir(sharedDir))
      continue

    const sharedCanonical = canonicalize(sharedDir)
    if (seen.has(sharedCanonical))
      continue
    seen.add(sharedCanonical)

    result.push({
      providerId: provider.id,
      componentName: descriptor.name,
      dir: sharedCanonical,
      kind: 'group-shared',
    })
  }

  debugScan(
    `resolved ${result.length} scan dir(s): `
    + `${result.map(r => `${r.componentName}${r.kind === 'group-shared' ? '#shared' : ''}`).join(', ') || '—'}`
    + `${skipped.length ? ` | skipped ${skipped.length}: ${skipped.map(s => `${s.componentName} (${s.reason})`).join(', ')}` : ''}`,
  )

  return { dirs: result, skipped }
}
