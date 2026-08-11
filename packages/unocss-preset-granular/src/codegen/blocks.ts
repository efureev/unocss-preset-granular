/**
 * Правка сгенерированных участков в живых файлах.
 *
 * Два способа, потому что цели разные. В TS-файлах генератор переписывает
 * только размеченный блок — остальное содержимое ему не принадлежит. В
 * `package.json` маркеров быть не может (это данные, не код), поэтому там
 * заменяется непрерывный ряд ключей на месте первого из них.
 */

import { GranularCodegenError } from './errors'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface ReplaceMarkedBlockOptions {
  /** Пространство имён маркеров, например `granularity:components`. */
  namespace: string
  /** Суффикс блока, когда их несколько в одном файле: `imports`, `registry`. */
  blockId?: string
  /** Путь файла — только для текста ошибки. */
  file: string
}

/**
 * Заменяет содержимое размеченного блока.
 *
 * Маркеры и отступ берутся из самого файла: генератор не навязывает
 * форматирование окружающему коду и не зависит от того, на каком уровне
 * вложенности живёт блок.
 */
export function replaceMarkedBlock(
  source: string,
  lines: readonly string[],
  options: ReplaceMarkedBlockOptions,
): string {
  const suffix = options.blockId ? `:${options.blockId}` : ''
  const openTag = `<${options.namespace}${suffix}>`
  const closeTag = `</${options.namespace}${suffix}>`

  const open = new RegExp(`^([ \\t]*)//\\s*${escapeRegExp(openTag)}.*$`, 'm')
  const openMatch = source.match(open)

  if (!openMatch || openMatch.index === undefined) {
    throw new GranularCodegenError(
      'missing-open-marker',
      `${options.file} has no opening marker \`// ${openTag}\`.`,
      options.file,
    )
  }

  const indent = openMatch[1] ?? ''
  const openIndex = openMatch.index + openMatch[0].length
  const close = new RegExp(`^[ \\t]*//\\s*${escapeRegExp(closeTag)}.*$`, 'm')
  const rest = source.slice(openIndex)
  const closeMatch = rest.match(close)

  if (!closeMatch || closeMatch.index === undefined) {
    throw new GranularCodegenError(
      'missing-close-marker',
      `${options.file} has no closing marker \`// ${closeTag}\`.`,
      options.file,
    )
  }

  const body = lines.map(line => (line ? `${indent}${line}` : '')).join('\n')

  // Всё между маркерами заменяется целиком; `rest.slice(closeMatch.index)` —
  // это закрывающий маркер и хвост файла.
  return `${source.slice(0, openIndex)}\n${body}\n${rest.slice(closeMatch.index)}`
}

export interface ReplacePackageExportsOptions {
  /** Ключи компонентов: по нему находится ряд, который надо заменить. */
  isComponentKey: (key: string) => boolean
  /** Значение subpath-экспорта одного компонента. */
  entryFor: (component: string) => unknown
  /** Как из имени компонента получается ключ экспорта. */
  keyFor: (component: string) => string
}

/**
 * Переписывает ряд subpath-экспортов компонентов в `package.json`, сохраняя
 * положение ряда и порядок всех остальных ключей.
 *
 * Ряд обязан быть непрерывным: ключи компонентов вставляются на место первого
 * из них, а прочие экспорты остаются по обе стороны в исходном порядке.
 */
export function replacePackageExports(
  source: string,
  components: readonly string[],
  options: ReplacePackageExportsOptions,
): string {
  const pkg = JSON.parse(source) as { exports?: Record<string, unknown> }

  if (!pkg.exports)
    throw new GranularCodegenError('missing-package-exports', 'package.json has no `exports` field.')

  const entries = Object.entries(pkg.exports)
  const firstComponentIndex = entries.findIndex(([key]) => options.isComponentKey(key))

  if (firstComponentIndex === -1) {
    throw new GranularCodegenError(
      'no-component-exports',
      'package.json#exports has no component subpath to anchor the generated run to.',
    )
  }

  const componentEntries = components.map(component => [
    options.keyFor(component),
    options.entryFor(component),
  ] as const)

  pkg.exports = Object.fromEntries([
    ...entries.slice(0, firstComponentIndex).filter(([key]) => !options.isComponentKey(key)),
    ...componentEntries,
    ...entries.slice(firstComponentIndex).filter(([key]) => !options.isComponentKey(key)),
  ])

  return `${JSON.stringify(pkg, null, 2)}\n`
}
