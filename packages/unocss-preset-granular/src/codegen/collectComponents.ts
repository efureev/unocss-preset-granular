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

export async function collectGranularComponents(options: CollectComponentsOptions): Promise<string[]> {
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

  const components = entries
    .filter(entry => entry.isDirectory() && entry.name.startsWith(prefix))
    .map(entry => entry.name)
    .filter(name => (
      existsSync(resolve(componentsDir, name, 'index.ts'))
      && existsSync(resolve(componentsDir, name, 'config.ts'))
    ))
    .sort(compareComponentNames)

  // Расхождение имени ловим здесь, а не отладкой сборки: собранный провайдер
  // с неверным импортом падает уже у потребителя.
  for (const component of components) {
    const source = await readFile(resolve(componentsDir, component, 'config.ts'), 'utf8')
    const declared = source.match(/export const (\w+)\s*=\s*defineGranularComponent/)?.[1]
    const expected = exportNameOf(component)

    if (declared !== expected) {
      throw new GranularCodegenError(
        'config-export-name-mismatch',
        `${component}/config.ts exports \`${declared ?? 'nothing recognisable'}\`, `
        + `but the registry expects \`${expected}\`. Rename the export: the name is derived `
        + `from the component's own name.`,
        `${component}/config.ts`,
      )
    }
  }

  return components
}
