import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { GranularCodegenError } from './errors'

/**
 * Обнаружение компонентов пакета-провайдера по файловой структуре.
 *
 * Компонент считается публичным, если у него есть и `index.ts`, и `config.ts`:
 * первое делает его импортируемым, второе — видимым пресету. Директория без
 * `config.ts` — заготовка, и в реестры она не попадает.
 */

/** Порядок во всех реестрах — регистронезависимый алфавитный. */
export function compareComponentNames(left: string, right: string): number {
  const a = left.toLowerCase()
  const b = right.toLowerCase()
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Имя экспорта конфига по имени компонента: `GrX` → `grXConfig`,
 * `XgQuickForm` → `xgQuickFormConfig`. Префикс опускается в нижний регистр,
 * остальное имя сохраняется.
 */
export function defaultConfigExportName(component: string, prefix: string): string {
  return `${prefix.toLowerCase()}${component.slice(prefix.length)}Config`
}

export interface CollectComponentsOptions {
  /** Абсолютный путь к директории с компонентами. */
  componentsDir: string
  /** Префикс имени директории компонента. По умолчанию `Gr`. */
  prefix?: string
  /**
   * Имя экспортируемого конфига. Проверяется по содержимому `config.ts`:
   * конвенция имени — часть контракта, по ней строится импорт в провайдере.
   */
  configExportName?: (component: string) => string
}

/**
 * Компонент и его путь относительно `componentsDir`.
 *
 * Путь отдельно от имени, потому что раскладка бывает не плоской: канон
 * группировки (раздел «Группы компонентов и shared SFC») кладёт компонент в
 * `<group>/<Component>/`, чтобы общий SFC группы попадал в область скана. Имя
 * при этом остаётся плоским — по нему строятся subpath и импорт, — а путь знает
 * только генератор.
 */
export interface GranularComponentEntry {
  name: string
  /** `FtExpenseModal` или `transaction-details/FtExpenseModal`. */
  dir: string
}

export async function collectGranularComponents(options: CollectComponentsOptions): Promise<string[]> {
  return (await collectGranularComponentEntries(options)).map(entry => entry.name)
}

/**
 * То же обнаружение, но с путями: групповая директория (та, что не начинается с
 * префикса) обходится на уровень вглубь.
 *
 * Без этого прогон без `--check` на сгруппированном пакете вычищал бы
 * сгруппированные компоненты из всех реестров разом — барреля, `exports`, entry
 * сборки и реестра провайдера, — то есть штатная команда ломала бы пакет,
 * раскладку которого предписывает документация.
 */
export async function collectGranularComponentEntries(
  options: CollectComponentsOptions,
): Promise<GranularComponentEntry[]> {
  const { componentsDir } = options
  const prefix = options.prefix ?? 'Gr'
  const exportNameOf = options.configExportName ?? (name => defaultConfigExportName(name, prefix))

  // Отсутствующая директория — не «ноль компонентов». Опечатка в
  // `componentsDir` тогда прошла бы молча и вычистила бы каждый реестр;
  // пустая, но существующая директория — законный случай свежего пакета.
  const entries = await readdir(componentsDir, { withFileTypes: true }).catch((cause: unknown) => {
    if ((cause as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new GranularCodegenError(
        'missing-components-dir',
        `Components directory not found: ${componentsDir}. `
        + 'An empty directory is fine — a missing one is treated as a misconfigured path, '
        + 'because silently reading zero components would strip every registry.',
        componentsDir,
      )
    }

    throw cause
  })

  const isComponentDir = (dir: string): boolean => (
    existsSync(resolve(componentsDir, dir, 'index.ts'))
    && existsSync(resolve(componentsDir, dir, 'config.ts'))
  )

  const found: GranularComponentEntry[] = []

  for (const entry of entries) {
    if (!entry.isDirectory())
      continue

    if (entry.name.startsWith(prefix)) {
      if (isComponentDir(entry.name))
        found.push({ name: entry.name, dir: entry.name })
      continue
    }

    // Директория без префикса — группа: заглядываем на уровень вглубь. Глубже
    // не идём намеренно, канон описывает ровно один уровень группировки, а
    // рекурсия затащила бы в реестры содержимое `shared/` и `__tests__/`.
    const nested = await readdir(resolve(componentsDir, entry.name), { withFileTypes: true }).catch(() => [])

    for (const child of nested) {
      if (!child.isDirectory() || !child.name.startsWith(prefix))
        continue

      const dir = `${entry.name}/${child.name}`
      if (isComponentDir(dir))
        found.push({ name: child.name, dir })
    }
  }

  const components = found.sort((left, right) => compareComponentNames(left.name, right.name))

  // Имя плоское во всех реестрах, поэтому двух одинаковых быть не может:
  // subpath и импорт конфига разошлись бы по разным модулям молча.
  const seen = new Map<string, string>()
  for (const { name, dir } of components) {
    const previous = seen.get(name)
    if (previous !== undefined) {
      throw new GranularCodegenError(
        'duplicate-component-name',
        `Component \`${name}\` is declared twice: \`${previous}\` and \`${dir}\`. `
        + 'Registry entries are keyed by name, so one of them would silently win.',
        dir,
      )
    }

    seen.set(name, dir)
  }

  // Расхождение имени ловим здесь, а не отладкой сборки: собранный провайдер
  // с неверным импортом падает уже у потребителя.
  for (const { name: component, dir } of components) {
    const source = await readFile(resolve(componentsDir, dir, 'config.ts'), 'utf8')
    const declared = source.match(/export const (\w+)\s*=\s*defineGranularComponent/)?.[1]
    const expected = exportNameOf(component)

    if (declared !== expected) {
      throw new GranularCodegenError(
        'config-export-name-mismatch',
        `${component}/config.ts exports \`${declared ?? 'nothing recognisable'}\`, `
        + `but the registry expects \`${expected}\`. Rename the export: the name is derived `
        + `from the component's own name.`,
        `${dir}/config.ts`,
      )
    }
  }

  return components
}
