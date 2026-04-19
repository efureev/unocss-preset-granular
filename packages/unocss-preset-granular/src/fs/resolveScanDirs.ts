import { existsSync, realpathSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { PresetGranularResolution } from '../preset'

/** Описание директории-источника для UnoCSS `content.filesystem`. */
export interface ResolvedScanDir {
  providerId: string
  componentName: string
  /** Абсолютный путь к директории (после realpath). */
  dir: string
}

function urlToPath(url: string): string | undefined {
  try {
    return fileURLToPath(new URL(url))
  }
  catch {
    return undefined
  }
}

function isExistingDir(path: string | undefined): path is string {
  if (!path)
    return false
  try {
    return existsSync(path) && statSync(path).isDirectory()
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
 * Для каждой резолвнутой entry выбирает директорию исходников по цепочке:
 *   1) `descriptor.sourceDirUrl` (как есть);
 *   2) `descriptor.sourceDirAssetName` относительно `provider.packageBaseUrl`
 *      (fallback для dist-сборки без `src/...`);
 *   3) `dirname(cssFiles[0])`;
 *   4) `packageBaseUrl + 'components/<Name>/'`.
 *
 * Директория засчитывается только если существует на диске. Итог дедуплицируется
 * по каноническому `realpath` (чтобы symlink из `node_modules` в `packages/...`
 * не дублировал скан).
 */
export function resolveComponentScanDirs(
  resolution: PresetGranularResolution,
): ResolvedScanDir[] {
  const result: ResolvedScanDir[] = []
  const seen = new Set<string>()

  for (const { provider, descriptor } of resolution.resolved.entries) {
    const candidates: (string | undefined)[] = []

    // 1) Наиболее специфичный путь — `packageBaseUrl + sourceDirAssetName`.
    //    Он указывает на компонент-локальную директорию в dist (например
    //    `dist/components/<Name>/`) и не зависит от того, во что бандлер
    //    превратил `import.meta.url` исходного `config.ts`.
    if (descriptor.sourceDirAssetName) {
      try {
        candidates.push(fileURLToPath(new URL(descriptor.sourceDirAssetName, provider.packageBaseUrl)))
      }
      catch {
        // ignore
      }
    }

    // 2) Прямой `sourceDirUrl` из `defineGranularComponent` — рассчитан от
    //    `import.meta.url` config‑модуля. Работает для dev/monorepo, где src
    //    действительно лежит рядом.
    if (descriptor.sourceDirUrl)
      candidates.push(urlToPath(descriptor.sourceDirUrl))

    // 3) Fallback: директория первого cssFile (`dirname(cssFiles[0])`).
    const firstCss = descriptor.cssFiles?.[0]
    if (firstCss) {
      const cssPath = urlToPath(firstCss)
      if (cssPath)
        candidates.push(dirname(cssPath))
    }

    // 4) Последний fallback — `packageBaseUrl + 'components/<Name>/'`.
    try {
      candidates.push(fileURLToPath(new URL(`components/${descriptor.name}/`, provider.packageBaseUrl)))
    }
    catch {
      // ignore
    }

    const picked = candidates.find(isExistingDir)
    if (!picked)
      continue

    const canonical = canonicalize(picked)
    if (seen.has(canonical))
      continue
    seen.add(canonical)

    result.push({
      providerId: provider.id,
      componentName: descriptor.name,
      dir: canonical,
    })
  }

  return result
}
