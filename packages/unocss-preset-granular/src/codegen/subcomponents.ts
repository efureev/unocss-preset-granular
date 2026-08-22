import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { compareComponentNames } from './collectComponents'
import { GranularCodegenError } from './errors'

/**
 * Подкомпоненты: части составного компонента, живущие в каталоге родителя.
 *
 * `GrTimelineItem`, `GrListItem`, пункты меню — у них нет ни своего `index.ts`,
 * ни `config.ts`, поэтому публичным компонентом провайдера они не считаются и в
 * реестры не попадают. Это верно: собственного конфига и entry у них быть не
 * должно, код всё равно лежит в чанке родителя.
 *
 * Верно и обратное: subpath у них должен быть. Без него гранулярный импорт
 * части упирается в `ERR_PACKAGE_PATH_NOT_EXPORTED`, то есть идея пакета на эти
 * имена не распространяется — хотя в шаблоне они пишутся такими же, как
 * остальные. Отсюда алиас: ключ свой, модуль родительский.
 *
 * Источник правды — баррель родителя: подкомпонент это то, что он реэкспортирует
 * как компонент.
 */

/**
 * `export { default as GrX } from './GrX.vue'`, в том числе с довеском в тех же
 * скобках (`{ default as GrX, type GrXProps }`), в двойных кавычках и из
 * подкаталога: части часто складывают в `parts/`, а модуль у них всё равно
 * родительский, поэтому вложенность на форму алиаса не влияет.
 */
const REEXPORT_RE = /export\s*\{\s*default\s+as\s+(\w+)\s*(?:,[^}]*)?\}\s*from\s*['"]\.\/(?:[\w.-]+\/)*([\w-]+)\.vue['"]/g

/**
 * Имена компонентов, которые баррель отдаёт наружу помимо самого себя.
 *
 * Форма разбирается строго, а не поиском имени: `export type { A as GrX }`
 * компонентом не является, и вольный поиск затащил бы в реестр типы.
 */
export function parseSubcomponents(source: string, parent: string, prefix = 'Gr'): string[] {
  const found: string[] = []

  for (const match of source.matchAll(REEXPORT_RE)) {
    const exported = match[1]
    const file = match[2]
    if (!exported || !file || exported === parent)
      continue

    // Реэкспорт под чужим именем — алиас, а не отдельная часть: subpath,
    // собранный по имени экспорта, вёл бы к модулю, где такого файла нет.
    if (exported !== file)
      continue

    // Префикс обязателен ровно как у компонента: баррель родителя реэкспортирует
    // и служебное (`TableCell`), а subpath — это публичный API пакета, и
    // расширять его молча генератор не вправе.
    if (!exported.startsWith(prefix))
      continue

    found.push(exported)
  }

  return found
}

export interface CollectSubcomponentsOptions {
  /** Абсолютный путь к директории с компонентами. */
  componentsDir: string
  /** Префикс имени директории компонента. По умолчанию `Gr`. */
  prefix?: string
  /**
   * Публичные компоненты — их имена уже заняты собственными модулями.
   * Совпадение с частью означает два разных модуля на одно имя.
   */
  components?: readonly string[]
}

/**
 * Карта «подкомпонент → компонент-владелец» по дереву исходников.
 *
 * Отсутствующая директория здесь — не ошибка, в отличие от
 * `collectGranularComponents`: тот на пустом месте вычистил бы каждый реестр, а
 * пустая карта лишь означает, что составных компонентов у провайдера нет.
 *
 * Каталоги обходятся в том же порядке, что и компоненты: у одного имени должен
 * быть один владелец независимо от того, в каком порядке их вернула ФС.
 */
export async function collectGranularSubcomponents(
  options: CollectSubcomponentsOptions,
): Promise<Record<string, string>> {
  const { componentsDir } = options
  const prefix = options.prefix ?? 'Gr'
  const components = new Set(options.components ?? [])

  const entries = await readdir(componentsDir, { withFileTypes: true }).catch(() => [])
  const parents = entries
    .filter(entry => entry.isDirectory() && entry.name.startsWith(prefix))
    .map(entry => entry.name)
    .sort(compareComponentNames)

  const map: Record<string, string> = {}

  for (const parent of parents) {
    const index = join(componentsDir, parent, 'index.ts')
    const readable = await stat(index).then(info => info.isFile()).catch(() => false)
    if (!readable)
      continue

    const source = await readFile(index, 'utf8')

    for (const name of parseSubcomponents(source, parent, prefix)) {
      // Одно имя — один модуль: subpath у пакета один, и при столкновении любой
      // из двух импортов вёл бы не туда. Молчаливый выбор победителя здесь хуже
      // отказа — в барреле провайдера такая пара уже даёт дублирующий экспорт.
      if (components.has(name)) {
        throw new GranularCodegenError(
          'subcomponent-name-clash',
          `${parent}/index.ts re-exports \`${name}\`, but \`${name}\` is also a component of its own. `
          + 'Two modules cannot share one subpath: rename the part, or drop the re-export.',
          `${parent}/index.ts`,
        )
      }

      const owner = map[name]
      if (owner && owner !== parent) {
        throw new GranularCodegenError(
          'subcomponent-name-clash',
          `\`${name}\` is re-exported by both ${owner} and ${parent}. `
          + 'A subcomponent belongs to exactly one component: rename one of the parts.',
          `${parent}/index.ts`,
        )
      }

      map[name] = parent
    }
  }

  return map
}
