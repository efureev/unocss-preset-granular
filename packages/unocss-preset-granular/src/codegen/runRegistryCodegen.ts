import type { GranularCodegenContext, GranularCodegenTarget } from './targets'
import { readFile, writeFile } from 'node:fs/promises'

import { resolve } from 'node:path'
import { collectGranularComponents, defaultConfigExportName } from './collectComponents'

export interface RunRegistryCodegenOptions {
  /** Корень пакета-провайдера. Обычно `fileURLToPath(new URL('..', import.meta.url))`. */
  packageDir: string
  /** Директория компонентов относительно корня. По умолчанию `src/components`. */
  componentsDir?: string
  /** Префикс имени компонента. По умолчанию `Gr`. */
  prefix?: string
  /** Пространство имён маркеров. По умолчанию `granularity:components`. */
  namespace?: string
  /** Имя экспорта конфига. По умолчанию `GrX` → `grXConfig`. */
  configExportName?: (component: string) => string
  /** Что генерировать. Несколько целей на один файл складываются по порядку. */
  targets: readonly GranularCodegenTarget[]
  /** Только проверить расхождение, ничего не писать. */
  check?: boolean
}

export interface RegistryCodegenResult {
  components: string[]
  /** Файлы, содержимое которых разошлось с ожидаемым. */
  stale: string[]
  /** Файлы, которые были перезаписаны (пусто при `check`). */
  written: string[]
}

/**
 * Приводит реестры пакета в соответствие с составом `src/components/`.
 *
 * Порядок работы: собрать компоненты по файловой системе → прогнать все цели,
 * накапливая правки по файлам → сравнить с текущим содержимым → записать либо
 * сообщить о расхождении.
 *
 * Правки накапливаются в памяти именно потому, что целей на один файл бывает
 * несколько (у провайдера — импорты и запись в реестр): читая файл заново на
 * каждую цель, вторая затёрла бы первую.
 */
export async function runRegistryCodegen(
  options: RunRegistryCodegenOptions,
): Promise<RegistryCodegenResult> {
  const prefix = options.prefix ?? 'Gr'
  const configExportName = options.configExportName ?? (name => defaultConfigExportName(name, prefix))

  const components = await collectGranularComponents({
    componentsDir: resolve(options.packageDir, options.componentsDir ?? 'src/components'),
    prefix,
    configExportName,
  })

  const context: GranularCodegenContext = {
    configExportName,
    namespace: options.namespace ?? 'granularity:components',
  }

  const original = new Map<string, string>()
  const next = new Map<string, string>()

  for (const target of options.targets) {
    if (!original.has(target.file)) {
      const source = await readFile(resolve(options.packageDir, target.file), 'utf8')
      original.set(target.file, source)
      next.set(target.file, source)
    }

    next.set(target.file, target.render(next.get(target.file)!, components, context))
  }

  const stale: string[] = []
  const written: string[] = []

  for (const [file, content] of next) {
    if (content === original.get(file))
      continue

    if (options.check) {
      stale.push(file)
      continue
    }

    await writeFile(resolve(options.packageDir, file), content, 'utf8')
    written.push(file)
  }

  return { components, stale, written }
}
