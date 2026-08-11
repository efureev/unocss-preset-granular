import { replaceMarkedBlock, replacePackageExports } from './blocks'

/**
 * Готовые цели генерации.
 *
 * Пакет-провайдер перечисляет свои компоненты в нескольких местах сразу, и
 * пропуск любого из них не даёт ошибки сборки — ломается что-то одно
 * (tree-shaking, subpath-импорт, скан UnoCSS-классов), причём молча. Здесь
 * собраны формы, общие для всех провайдеров; свои — через `markedBlock`.
 */

export interface GranularCodegenContext {
  /** Имя экспорта конфига по имени компонента. */
  configExportName: (component: string) => string
  /** Пространство имён маркеров. */
  namespace: string
}

export interface GranularCodegenTarget {
  /** Путь относительно корня пакета. */
  file: string
  render: (source: string, components: readonly string[], context: GranularCodegenContext) => string
}

/**
 * Произвольный размеченный блок. Через него выражаются и стандартные цели, и
 * то, что есть только у companion-пакетов: whitelist резолвера авто-импорта,
 * список для `granularAssetFileNames`.
 */
export function markedBlock(options: {
  file: string
  blockId?: string
  lines: (components: readonly string[], context: GranularCodegenContext) => string[]
}): GranularCodegenTarget {
  return {
    file: options.file,
    render: (source, components, context) => replaceMarkedBlock(
      source,
      options.lines(components, context),
      { namespace: context.namespace, blockId: options.blockId, file: options.file },
    ),
  }
}

/** Root-barrel: `export * from './components/GrX'`. */
export function barrel(file = 'src/index.ts'): GranularCodegenTarget {
  return markedBlock({
    file,
    lines: components => components.map(component => `export * from './components/${component}'`),
  })
}

/** Entry на компонент в `vite.config.ts` — по entry на каждый, ради tree-shaking. */
export function viteEntries(file = 'vite.config.ts'): GranularCodegenTarget {
  return markedBlock({
    file,
    lines: components => components.flatMap(component => [
      `'components/${component}/index': fileURLToPath(`,
      `  new URL('./src/components/${component}/index.ts', import.meta.url),`,
      '),',
    ]),
  })
}

/**
 * Провайдер: импорты конфигов и запись в реестр. Две метки в одном файле,
 * поэтому две цели — рендеры складываются по порядку.
 */
export function providerRegistry(file = 'src/granular-provider/shared.ts'): GranularCodegenTarget[] {
  return [
    markedBlock({
      file,
      blockId: 'imports',
      lines: (components, context) => components.map(component => (
        `import { ${context.configExportName(component)} } from '../components/${component}/config'`
      )),
    }),
    markedBlock({
      file,
      blockId: 'registry',
      lines: (components, context) => components.map(component => (
        `${component}: ${context.configExportName(component)},`
      )),
    }),
  ]
}

/** Subpath-экспорт на компонент в `package.json`. */
export function packageExports(options: {
  file?: string
  /** Префикс ключа. По умолчанию `./components/`. */
  keyPrefix?: string
  /** Значение экспорта. По умолчанию — пара `types` + `import` в `dist`. */
  entryFor?: (component: string) => unknown
} = {}): GranularCodegenTarget {
  const file = options.file ?? 'package.json'
  const keyPrefix = options.keyPrefix ?? './components/'
  const entryFor = options.entryFor ?? ((component: string) => ({
    types: `./dist/types/src/components/${component}/index.d.ts`,
    import: `./dist/components/${component}/index.js`,
  }))

  return {
    file,
    render: (source, components) => replacePackageExports(source, components, {
      isComponentKey: key => key.startsWith(keyPrefix),
      keyFor: component => `${keyPrefix}${component}`,
      entryFor,
    }),
  }
}
