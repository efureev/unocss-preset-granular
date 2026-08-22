import { replaceMarkedBlock, replacePackageExports } from './blocks'
import { compareComponentNames } from './collectComponents'

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
  /**
   * Путь компонента относительно `src/components` — `GrButton` у плоской
   * раскладки, `transaction-details/FtExpenseModal` у групповой. Имя остаётся
   * плоским: по нему строятся subpath и импорт, путь знает только генератор.
   */
  componentPath: (component: string) => string
  /**
   * Подкомпоненты: имя → компонент-владелец. Публичными компонентами они не
   * считаются и в реестры не попадают — но subpath у них быть обязан, иначе
   * гранулярный импорт части составного компонента невозможен вовсе.
   */
  subcomponents: Readonly<Record<string, string>>
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
    lines: (components, context) => components.map(component => `export * from './components/${context.componentPath(component)}'`),
  })
}

/** Entry на компонент в `vite.config.ts` — по entry на каждый, ради tree-shaking. */
export function viteEntries(file = 'vite.config.ts'): GranularCodegenTarget {
  return markedBlock({
    file,
    lines: (components, context) => components.flatMap(component => [
      `'components/${context.componentPath(component)}/index': fileURLToPath(`,
      `  new URL('./src/components/${context.componentPath(component)}/index.ts', import.meta.url),`,
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
        `import { ${context.configExportName(component)} } from '../components/${context.componentPath(component)}/config'`
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

/**
 * Ключ компонента — ровно `<keyPrefix><Name>`.
 *
 * Ряд, который переписывает генератор, состоит только из таких ключей. Ни
 * вложенный subpath компонента (`./components/GrX/styles.css`), ни паттерн
 * (`./components/*`) именем компонента не являются: сгенерировать их генератор
 * не умеет, а значит и вычищать не вправе.
 */
function isComponentKey(keyPrefix: string): (key: string) => boolean {
  return (key) => {
    if (!key.startsWith(keyPrefix))
      return false

    const name = key.slice(keyPrefix.length)

    return name.length > 0 && !name.includes('/') && !name.includes('*')
  }
}

/**
 * Subpath-экспорт на компонент в `package.json`.
 *
 * Ключом компонента считается ровно `<keyPrefix><Name>` — один сегмент и без
 * подстановки. Всё, что глубже (`./components/GrX/styles.css`) или является
 * паттерном (`./components/*`), принадлежит пакету, а не генератору: такие
 * ключи остаются на месте, как `.` и `./contract`. Иначе пакет молча терял бы
 * опубликованный subpath, а узнавал бы об этом потребитель — на сборке, с
 * `ERR_PACKAGE_PATH_NOT_EXPORTED`.
 *
 * С `subcomponents: true` рядом с компонентами встают алиасы на части
 * составных: ключ свой, модуль — родительский. Отдельной entry такой алиас не
 * требует, код части и так лежит в чанке родителя; без него же гранулярный
 * импорт этой части невозможен (`ERR_PACKAGE_PATH_NOT_EXPORTED`).
 *
 * По умолчанию выключено: у провайдера, который до сих пор обходился без
 * алиасов, `package.json` не должен меняться от одного обновления пресета.
 */
export function packageExports(options: {
  file?: string
  /** Префикс ключа. По умолчанию `./components/`. */
  keyPrefix?: string
  /**
   * Значение экспорта. По умолчанию — пара `types` + `import` в `dist`.
   *
   * Вторым аргументом приходит путь компонента относительно `src/components`:
   * у плоской раскладки он равен имени, у групповой несёт группу. Ключ при этом
   * строится по имени — потребитель импортирует компонент, а не его место в
   * дереве исходников.
   */
  entryFor?: (component: string, path: string) => unknown
  /** Добавлять ли алиасы на подкомпоненты. По умолчанию `false`. */
  subcomponents?: boolean
} = {}): GranularCodegenTarget {
  const file = options.file ?? 'package.json'
  const keyPrefix = options.keyPrefix ?? './components/'
  const entryFor = options.entryFor ?? ((_component: string, path: string) => ({
    types: `./dist/types/src/components/${path}/index.d.ts`,
    import: `./dist/components/${path}/index.js`,
  }))

  return {
    file,
    render: (source, components, context) => {
      const subcomponents = options.subcomponents ? context.subcomponents : {}
      const names = [...components, ...Object.keys(subcomponents)].sort(compareComponentNames)

      return replacePackageExports(source, names, {
        isComponentKey: isComponentKey(keyPrefix),
        keyFor: name => `${keyPrefix}${name}`,
        // Ключ строится по имени части, значение — по её владельцу: свой модуль
        // существует только у него.
        entryFor: (name) => {
          const owner = subcomponents[name] ?? name

          return entryFor(owner, context.componentPath(owner))
        },
      })
    },
  }
}
