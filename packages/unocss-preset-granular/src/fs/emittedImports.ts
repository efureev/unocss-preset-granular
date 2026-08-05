import type { Dirent } from 'node:fs'
import type { GranularProvider } from '../contract'
import type { ComponentKey } from '../core/registry'
import type { PresetGranularResolution } from '../preset'
import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { toComponentKey } from '../core/registry'

/** Найденный в бандле импорт из директории одного компонента в директорию другого. */
export interface EmittedImportEdge {
  /** Компонент-владелец файла, где найден импорт. */
  from: ComponentKey
  /** Компонент, в чью директорию ведёт импорт. */
  to: ComponentKey
  /** Файл с импортом, путь относительно директории компонента-владельца. */
  source: string
  /** Спецификатор как он записан в бандле. */
  specifier: string
}

/**
 * Статические и динамические спецификаторы модулей.
 *
 * Разбор регулярным выражением, а не парсером: цель — не построить точный граф,
 * а заметить импорт в чужую директорию. Лишнее совпадение (спецификатор внутри
 * строкового литерала) приведёт к предупреждению, которого можно не заметить;
 * пропущенный импорт вернул бы нас к молчанию, ради устранения которого всё и
 * затевалось.
 */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["']([^"'\n]+)["']/g

/**
 * Читаемые расширения. `.map` исключены намеренно: там инлайн-исходники.
 *
 * `.cjs` исключён сознательно: {@link SPECIFIER} не понимает `require()`, и
 * держать расширение в списке значило бы обещать поддержку CJS-вывода,
 * которой нет — молчаливый ноль вместо честного «не проверяем». Ограничение
 * зафиксировано в `docs/{en,ru}/cli.md`.
 */
const SCANNABLE = /\.(?:js|mjs)$/

function safeRealpath(path: string): string {
  try {
    return realpathSync(path)
  }
  catch {
    return path
  }
}

function collectFiles(dir: string, acc: string[] = []): string[] {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  }
  catch {
    return acc
  }

  for (const entry of entries) {
    const path = resolvePath(dir, entry.name)
    if (entry.isDirectory())
      collectFiles(path, acc)
    else if (SCANNABLE.test(entry.name))
      acc.push(path)
  }
  return acc
}

/**
 * `<packageBaseUrl>/components/<Name>/` компонента, без завершающего
 * разделителя и без проверок FS. `undefined` — некорректный `packageBaseUrl`
 * (для этого есть отдельная диагностика layout-контракта).
 */
function componentDir(provider: GranularProvider, name: string): string | undefined {
  try {
    return safeRealpath(resolvePath(fileURLToPath(new URL(`components/${name}/`, provider.packageBaseUrl))))
  }
  catch {
    return undefined
  }
}

/** Директории ВСЕХ компонентов всех провайдеров — цели, в которые может вести импорт. */
function componentDirs(providers: readonly GranularProvider[]): Map<string, ComponentKey> {
  const dirs = new Map<string, ComponentKey>()

  for (const provider of providers) {
    for (const descriptor of provider.components) {
      const dir = componentDir(provider, descriptor.name)
      if (dir === undefined)
        continue
      // Ключ с завершающим разделителем — иначе `GrCard/` совпадёт с `GrCardHeader/`.
      dirs.set(dir + sep, toComponentKey(provider.id, descriptor.name))
    }
  }

  return dirs
}

/**
 * Bare-спецификатор вида `<providerId>/components/<ComponentName>[/…]`
 * (или `<providerId>/<ComponentName>[/…]`, если пакет экспортирует компоненты
 * с корня).
 *
 * Опирается на конвенцию «id провайдера = имя npm-пакета»: контракт этого не
 * требует, поэтому несовпадение молча даёт `undefined` — лучше пропустить
 * межпакетное ребро, чем обвинить провайдера, у которого id просто назван
 * иначе.
 *
 * Имя компонента берётся из ОДНОЙ детерминированной позиции: сразу за
 * сегментом `components`, а если его нет — первым сегментом. Свободный поиск
 * «имя где-нибудь в пути» давал ребро на `@pkg/utils/Button/format.js`
 * (`Button` там — не компонент) и на двух именах в пути зависел от порядка
 * `provider.components`.
 */
function matchBareSpecifier(
  specifier: string,
  providers: readonly GranularProvider[],
): ComponentKey | undefined {
  for (const provider of providers) {
    if (!specifier.startsWith(`${provider.id}/`))
      continue

    const segments = specifier.slice(provider.id.length + 1).split('/')
    const at = segments.indexOf('components')
    const name = at === -1 ? segments[0] : segments[at + 1]
    if (name === undefined)
      continue

    if (provider.components.some(descriptor => descriptor.name === name))
      return toComponentKey(provider.id, name)
  }
  return undefined
}

/** Один разобранный спецификатор файла. `target` есть только у относительных. */
interface ParsedSpecifier {
  specifier: string
  target?: string
}

/** Корень пакета провайдера (canonical), для читаемого `source` вне `ownDir`. */
function packageRoot(provider: GranularProvider): string | undefined {
  try {
    return safeRealpath(fileURLToPath(provider.packageBaseUrl))
  }
  catch {
    return undefined
  }
}

/**
 * Ищет в собранных файлах выбранных компонентов импорты, ведущие в директорию
 * ДРУГОГО granular-компонента.
 *
 * Зачем это отдельно от графа `dependencies`: граф — это то, что провайдер
 * ОБЪЯВИЛ, а здесь читается то, что он реально ОТГРУЗИЛ. Разойтись они могут
 * бесшумно — сборка провайдера от `dependencies` не зависит вовсе.
 *
 * Обход идёт СКВОЗЬ не-компонентные файлы пакета (`chunks/`,
 * `groups/<group>/shared/`): бандлер выносит туда модуль, общий для нескольких
 * компонентов, и путь `A → shared → B` — такое же ребро, как прямой импорт,
 * но по прямым рёбрам он невидим. Ребро приписывается компоненту, от которого
 * начался обход; `source` показывает файл, где импорт реально записан.
 *
 * Работает по `dist`, исходники и AST фреймворка не нужны, поэтому одинаково
 * применимо к любому провайдеру, включая опубликованный в npm.
 */
export function inspectEmittedComponentImports(
  resolution: PresetGranularResolution,
): EmittedImportEdge[] {
  const dirs = componentDirs(resolution.providers)
  const edges: EmittedImportEdge[] = []
  const seen = new Set<string>()

  // Общие чанки читаются один раз на всю инспекцию, а не на каждый компонент,
  // который до них дошёл: 61 компонент × 185 общих чанков — это тот же файл,
  // разобранный сотню раз.
  const parsed = new Map<string, readonly ParsedSpecifier[]>()

  const locate = (path: string): ComponentKey | undefined => {
    for (const [dir, key] of dirs) {
      // Ключи с завершающим разделителем (иначе `GrCard/` совпал бы с
      // `GrCardHeader/`), но `path` может быть и самой директорией —
      // `import "../B"` без имени файла.
      if (path.startsWith(dir) || path === dir.slice(0, -1))
        return key
    }
    return undefined
  }

  const parse = (file: string): readonly ParsedSpecifier[] => {
    const cached = parsed.get(file)
    if (cached)
      return cached

    let code: string
    try {
      code = readFileSync(file, 'utf8')
    }
    catch {
      code = ''
    }

    const result: ParsedSpecifier[] = []
    for (const [, specifier] of code.matchAll(SPECIFIER)) {
      result.push(specifier.startsWith('.')
        ? { specifier, target: safeRealpath(resolvePath(dirname(file), specifier)) }
        : { specifier })
    }

    parsed.set(file, result)
    return result
  }

  for (const { provider, descriptor } of resolution.resolved.entries) {
    const from = toComponentKey(provider.id, descriptor.name)
    const ownDir = componentDir(provider, descriptor.name)
    if (ownDir === undefined)
      continue

    const root = packageRoot(provider)
    const queue = collectFiles(ownDir)
    const visited = new Set(queue)

    while (queue.length > 0) {
      const file = queue.pop()!

      for (const { specifier, target } of parse(file)) {
        const to = target === undefined
          ? matchBareSpecifier(specifier, resolution.providers)
          : locate(target)

        if (to === undefined) {
          // Не компонент — общий чанк пакета либо внешний пакет. В первый
          // случай проваливаемся, во второй `SCANNABLE`/FS просто не пустят.
          if (target !== undefined && SCANNABLE.test(target) && !visited.has(target)) {
            visited.add(target)
            queue.push(target)
          }
          continue
        }

        // Свои же файлы уже в очереди (их собрал `collectFiles`).
        if (to === from)
          continue

        // Одно ребро на пару компонентов: чанков в директории много, и
        // повторять «A → B» по разу на файл значит утопить отчёт в шуме.
        const dedupe = `${from}\0${to}`
        if (seen.has(dedupe))
          continue
        seen.add(dedupe)

        edges.push({ from, to, source: relativeSource(file, ownDir, root), specifier })
      }
    }
  }

  return edges
}

/**
 * Путь к файлу с импортом: относительно директории компонента, а для файла
 * вне её (общий чанк) — относительно корня пакета. Абсолютный путь остаётся
 * только там, где ни то ни другое не приложилось.
 */
function relativeSource(file: string, ownDir: string, root: string | undefined): string {
  if (file.startsWith(ownDir + sep))
    return file.slice(ownDir.length + 1)
  if (root !== undefined && file.startsWith(root + sep))
    return file.slice(root.length + 1)
  return file
}
