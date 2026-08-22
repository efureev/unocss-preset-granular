import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

import { codegenTargets, collectGranularSubcomponents, GranularCodegenError, replaceMarkedBlock, runRegistryCodegen } from '../codegen'

/**
 * Генератор работает с настоящими файлами, поэтому и тесты — на настоящем
 * пакете во временной директории. Проверка «отрендерил строку» ничего бы не
 * стоила: вся цена ошибки в том, как правка ложится в живой файл рядом с
 * чужим кодом.
 */

let pkgDir: string

async function write(relative: string, content: string) {
  const path = join(pkgDir, relative)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content, 'utf8')
}

async function read(relative: string) {
  return readFile(join(pkgDir, relative), 'utf8')
}

/** Компонент считается публичным только с парой `index.ts` + `config.ts`. */
async function component(name: string, { config = true } = {}) {
  await write(`src/components/${name}/index.ts`, `export {}\n`)
  if (config) {
    await write(
      `src/components/${name}/config.ts`,
      `export const ${name[0].toLowerCase()}${name.slice(1)}Config = defineGranularComponent(import.meta.url, { name: '${name}' })\n`,
    )
  }
}

const BARREL = `// шапка файла, генератору не принадлежит
// <granularity:components>
// </granularity:components>
`

const VITE = `export default {
  entry: {
    index: 'src/index.ts',
    // <granularity:components>
    // </granularity:components>
  },
}
`

const PROVIDER = `import { defineGranularProvider } from '@feugene/unocss-preset-granular/contract'
// <granularity:components:imports>
// </granularity:components:imports>

export const provider = defineGranularProvider({
  components: {
    // <granularity:components:registry>
    // </granularity:components:registry>
  },
})
`

const PACKAGE_JSON = `${JSON.stringify({
  name: '@acme/kit',
  exports: {
    '.': { import: './dist/index.js' },
    './components/GrOld': { import: './dist/components/GrOld/index.js' },
    './contract': { import: './dist/contract.js' },
  },
}, null, 2)}\n`

beforeEach(async () => {
  pkgDir = await mkdtemp(join(tmpdir(), 'granular-codegen-'))
  await write('src/index.ts', BARREL)
  await write('vite.config.ts', VITE)
  await write('src/granular-provider/shared.ts', PROVIDER)
  await write('package.json', PACKAGE_JSON)
})

function standardTargets() {
  return [
    codegenTargets.barrel(),
    codegenTargets.viteEntries(),
    codegenTargets.packageExports(),
    ...codegenTargets.providerRegistry(),
  ]
}

describe('runRegistryCodegen', () => {
  it('собирает компоненты по файловой системе в алфавитном порядке', async () => {
    await component('GrTabs')
    await component('GrAlert')
    await component('GrTabPanels')

    const result = await runRegistryCodegen({ packageDir: pkgDir, targets: standardTargets() })

    // Регистронезависимо: иначе `GrTabPanels` и `GrTabs` разъезжаются между
    // реестрами — ровно так они и разошлись до появления генератора.
    expect(result.components).toEqual(['GrAlert', 'GrTabPanels', 'GrTabs'])
  })

  it('директория без config.ts публичным компонентом не считается', async () => {
    await component('GrAlert')
    await component('GrDraft', { config: false })

    const result = await runRegistryCodegen({ packageDir: pkgDir, targets: standardTargets() })

    expect(result.components).toEqual(['GrAlert'])
  })

  it('расхождение имени конфига — ошибка с указанием ожидаемого имени', async () => {
    await write('src/components/GrAlert/index.ts', 'export {}\n')
    await write('src/components/GrAlert/config.ts', 'export const alertCfg = defineGranularComponent()\n')

    const failure = runRegistryCodegen({ packageDir: pkgDir, targets: standardTargets() })

    await expect(failure).rejects.toThrow(/expects `grAlertConfig`/)
    // Причина машиночитаема: вызывающему нужно отличать «реестры разошлись»
    // от «сломалась сама оснастка», а не разбирать текст сообщения.
    await expect(failure).rejects.toMatchObject({
      name: 'GranularCodegenError',
      reason: 'config-export-name-mismatch',
      file: 'GrAlert/config.ts',
    })
  })

  it('пишет barrel, оставляя чужой текст файла нетронутым', async () => {
    await component('GrAlert')
    await component('GrButton')

    await runRegistryCodegen({ packageDir: pkgDir, targets: standardTargets() })

    const barrel = await read('src/index.ts')
    expect(barrel).toContain('// шапка файла, генератору не принадлежит')
    expect(barrel).toContain(`export * from './components/GrAlert'`)
    expect(barrel).toContain(`export * from './components/GrButton'`)
  })

  it('сохраняет отступ блока, а не навязывает свой', async () => {
    await component('GrAlert')

    await runRegistryCodegen({ packageDir: pkgDir, targets: standardTargets() })

    // Блок в `vite.config.ts` лежит на четвёртом уровне вложенности.
    expect(await read('vite.config.ts')).toContain(`    'components/GrAlert/index': fileURLToPath(`)
  })

  it('две метки в одном файле складываются, а не затирают друг друга', async () => {
    await component('GrAlert')

    await runRegistryCodegen({ packageDir: pkgDir, targets: standardTargets() })

    const provider = await read('src/granular-provider/shared.ts')
    expect(provider).toContain(`import { grAlertConfig } from '../components/GrAlert/config'`)
    expect(provider).toContain('GrAlert: grAlertConfig,')
  })

  it('в package.json ряд компонентов встаёт на место прежнего, порядок прочих ключей цел', async () => {
    await component('GrAlert')
    await component('GrButton')

    await runRegistryCodegen({ packageDir: pkgDir, targets: standardTargets() })

    const pkg = JSON.parse(await read('package.json'))
    expect(Object.keys(pkg.exports)).toEqual([
      '.',
      './components/GrAlert',
      './components/GrButton',
      './contract',
    ])
    // Прежний `GrOld` исчез: состав задаёт файловая система, а не файл.
    expect(pkg.exports['./components/GrOld']).toBeUndefined()
  })

  it('пакет без компонентов проходит: якорить нечего и вставлять нечего', async () => {
    // Первый прогон свежесозданного провайдера. Ошибка здесь означала бы, что
    // каркас пакета нельзя проверить генератором до появления компонента.
    await mkdir(join(pkgDir, 'src/components'), { recursive: true })
    await write('package.json', `${JSON.stringify({
      name: '@acme/fresh',
      exports: { '.': { import: './dist/index.js' } },
    }, null, 2)}\n`)

    const result = await runRegistryCodegen({ packageDir: pkgDir, targets: standardTargets() })

    expect(result.components).toEqual([])
    expect(JSON.parse(await read('package.json')).exports).toEqual({ '.': { import: './dist/index.js' } })
  })

  it('но без якоря при живых компонентах — ошибка: молчание потеряло бы их', async () => {
    await component('GrAlert')
    await write('package.json', `${JSON.stringify({
      name: '@acme/kit',
      exports: { '.': { import: './dist/index.js' } },
    }, null, 2)}\n`)

    await expect(runRegistryCodegen({ packageDir: pkgDir, targets: standardTargets() }))
      .rejects
      .toMatchObject({ reason: 'no-component-exports' })
  })

  it('отсутствующая директория компонентов — ошибка, а не «ноль компонентов»', async () => {
    // Молчание здесь означало бы, что опечатка в пути вычистит каждый реестр.
    await expect(runRegistryCodegen({ packageDir: pkgDir, targets: standardTargets() }))
      .rejects
      .toMatchObject({ reason: 'missing-components-dir' })
  })

  it('check ничего не пишет и называет разошедшиеся файлы', async () => {
    await component('GrAlert')

    const before = await read('src/index.ts')
    const result = await runRegistryCodegen({ packageDir: pkgDir, targets: standardTargets(), check: true })

    expect(result.stale).toContain('src/index.ts')
    expect(result.written).toEqual([])
    expect(await read('src/index.ts')).toBe(before)
  })

  it('на актуальных реестрах check молчит', async () => {
    await component('GrAlert')
    await runRegistryCodegen({ packageDir: pkgDir, targets: standardTargets() })

    const result = await runRegistryCodegen({ packageDir: pkgDir, targets: standardTargets(), check: true })

    expect(result.stale).toEqual([])
  })

  it('повторный прогон ничего не меняет', async () => {
    await component('GrAlert')
    await runRegistryCodegen({ packageDir: pkgDir, targets: standardTargets() })
    const first = await read('src/granular-provider/shared.ts')

    await runRegistryCodegen({ packageDir: pkgDir, targets: standardTargets() })

    expect(await read('src/granular-provider/shared.ts')).toBe(first)
  })
})

/**
 * Части составного компонента: свой subpath при общем модуле.
 *
 * Публичным компонентом такая часть не считается — ни `config.ts`, ни entry у
 * неё нет и быть не должно. Но без subpath её нельзя импортировать гранулярно
 * вовсе, то есть идея пакета на неё не распространяется.
 */
describe('подкомпоненты', () => {
  /** Часть живёт в каталоге родителя и реэкспортируется его баррелем. */
  async function part(parent: string, name: string, reexport = `export { default as ${name} } from './${name}.vue'`) {
    await write(`src/components/${parent}/${name}.vue`, '<template><div /></template>\n')
    await write(`src/components/${parent}/index.ts`, `export { default } from './${parent}.vue'\n${reexport}\n`)
  }

  it('получают subpath на модуль родителя, но не свою entry', async () => {
    await component('GrTimeline')
    await part('GrTimeline', 'GrTimelineItem')

    await runRegistryCodegen({
      packageDir: pkgDir,
      targets: [
        codegenTargets.barrel(),
        codegenTargets.viteEntries(),
        codegenTargets.packageExports({ subcomponents: true }),
      ],
    })

    const pkg = JSON.parse(await read('package.json'))

    expect(pkg.exports['./components/GrTimelineItem']).toEqual(pkg.exports['./components/GrTimeline'])
    // Своя entry дублировала бы код: он уже в чанке родителя.
    expect(await read('vite.config.ts')).not.toContain(`'components/GrTimelineItem/index'`)
    // В barrel часть тоже не попадает — её отдаёт баррель родителя.
    expect(await read('src/index.ts')).not.toContain('GrTimelineItem')
  })

  it('без опции package.json не меняется', async () => {
    await component('GrTimeline')
    await part('GrTimeline', 'GrTimelineItem')

    await runRegistryCodegen({
      packageDir: pkgDir,
      targets: [codegenTargets.packageExports()],
    })

    const pkg = JSON.parse(await read('package.json'))

    expect(pkg.exports['./components/GrTimelineItem']).toBeUndefined()
  })

  it('реэкспорт под чужим именем алиасом не считается', async () => {
    await component('GrTimeline')
    // Имя экспорта и файл разошлись: subpath по имени вёл бы в никуда.
    await part('GrTimeline', 'GrTimelineItem', `export { default as GrSomethingElse } from './GrTimelineItem.vue'`)

    await runRegistryCodegen({
      packageDir: pkgDir,
      targets: [codegenTargets.packageExports({ subcomponents: true })],
    })

    const pkg = JSON.parse(await read('package.json'))

    expect(pkg.exports['./components/GrSomethingElse']).toBeUndefined()
    expect(pkg.exports['./components/GrTimelineItem']).toBeUndefined()
  })

  it('порядок общий с компонентами, а не хвостом', async () => {
    await component('GrAlert')
    await component('GrTimeline')
    await part('GrTimeline', 'GrTimelineItem')

    await runRegistryCodegen({
      packageDir: pkgDir,
      targets: [codegenTargets.packageExports({ subcomponents: true })],
    })

    const pkg = JSON.parse(await read('package.json'))
    const keys = Object.keys(pkg.exports).filter(key => key.startsWith('./components/'))

    expect(keys).toEqual(['./components/GrAlert', './components/GrTimeline', './components/GrTimelineItem'])
  })

  it('часть из подкаталога — тот же алиас', async () => {
    await component('GrNested')
    // Части часто складывают в `parts/`, а модуль у них всё равно родительский:
    // вложенность на форму алиаса не влияет, и пропустить её — молча оставить
    // самый частый вид части без subpath.
    await write('src/components/GrNested/parts/GrNestedHeader.vue', '<template><div /></template>\n')
    await write(
      'src/components/GrNested/index.ts',
      `export { default } from './GrNested.vue'\nexport { default as GrNestedHeader } from './parts/GrNestedHeader.vue'\n`,
    )

    await runRegistryCodegen({
      packageDir: pkgDir,
      targets: [codegenTargets.packageExports({ subcomponents: true })],
    })

    const pkg = JSON.parse(await read('package.json'))

    expect(pkg.exports['./components/GrNestedHeader']).toEqual(pkg.exports['./components/GrNested'])
  })

  it('кавычки реэкспорта — любые', async () => {
    await component('GrTabs')
    // Стиль кавычек задаёт линтер провайдера, а не пресет.
    await part('GrTabs', 'GrTab', `export { default as GrTab } from "./GrTab.vue"`)

    await runRegistryCodegen({
      packageDir: pkgDir,
      targets: [codegenTargets.packageExports({ subcomponents: true })],
    })

    const pkg = JSON.parse(await read('package.json'))

    expect(pkg.exports['./components/GrTab']).toEqual(pkg.exports['./components/GrTabs'])
  })

  it('имя без префикса subpath не получает', async () => {
    await component('GrTable')
    // Служебная часть баррелем отдаётся, но публичным API пакета не является:
    // расширять его молча генератор не вправе.
    await part('GrTable', 'TableCell')

    await runRegistryCodegen({
      packageDir: pkgDir,
      targets: [codegenTargets.packageExports({ subcomponents: true })],
    })

    const pkg = JSON.parse(await read('package.json'))

    expect(pkg.exports['./components/TableCell']).toBeUndefined()
  })

  it('тёзка публичного компонента — ошибка, а не подмена его subpath', async () => {
    await component('GrList')
    await component('GrListItem')
    // Два модуля на одно имя: баррель провайдера уже даёт дублирующий экспорт,
    // а subpath у пакета один — тихий выбор победителя увёл бы импорт компонента
    // в чанк родителя вместе с его собственной entry.
    await part('GrList', 'GrListItem')

    await expect(runRegistryCodegen({
      packageDir: pkgDir,
      targets: [codegenTargets.packageExports({ subcomponents: true })],
    }))
      .rejects
      .toMatchObject({ reason: 'subcomponent-name-clash' })
  })

  it('карты нет там, где нет и составных: пустая директория и заготовка', async () => {
    const componentsDir = join(pkgDir, 'src/components')

    // Отсутствие директории здесь — не ошибка, в отличие от компонентов: там
    // молчание вычистило бы каждый реестр, здесь оно означает лишь «составных нет».
    await expect(collectGranularSubcomponents({ componentsDir })).resolves.toEqual({})

    // Заготовка без `index.ts` баррелем не обладает, значит и частей у неё нет.
    await write('src/components/GrDraft/GrDraftItem.vue', '<template><div /></template>\n')

    await expect(collectGranularSubcomponents({ componentsDir })).resolves.toEqual({})
  })

  it('одно имя у двух родителей — ошибка, а не порядок обхода ФС', async () => {
    await component('GrList')
    await component('GrMenu')
    await part('GrList', 'GrItem')
    await part('GrMenu', 'GrItem')

    await expect(runRegistryCodegen({
      packageDir: pkgDir,
      targets: [codegenTargets.packageExports({ subcomponents: true })],
    }))
      .rejects
      .toMatchObject({ reason: 'subcomponent-name-clash' })
  })
})

describe('свои цели companion-пакета', () => {
  it('markedBlock покрывает whitelist резолвера', async () => {
    await component('GrDatePicker')
    await component('GrTimePicker')
    await write(
      'src/resolver.ts',
      `export const COMPONENTS = [\n  // <granularity:components>\n  // </granularity:components>\n] as const\n`,
    )

    await runRegistryCodegen({
      packageDir: pkgDir,
      targets: [
        codegenTargets.markedBlock({
          file: 'src/resolver.ts',
          lines: components => components.map(name => `'${name}',`),
        }),
      ],
    })

    expect(await read('src/resolver.ts')).toContain(`  'GrDatePicker',\n  'GrTimePicker',`)
  })

  it('префикс и имя конфига настраиваются — companion может звать компоненты иначе', async () => {
    await write('src/components/XgQuickForm/index.ts', 'export {}\n')
    await write(
      'src/components/XgQuickForm/config.ts',
      'export const xgQuickFormConfig = defineGranularComponent()\n',
    )

    const result = await runRegistryCodegen({
      packageDir: pkgDir,
      prefix: 'Xg',
      targets: [codegenTargets.barrel()],
    })

    expect(result.components).toEqual(['XgQuickForm'])
    expect(await read('src/index.ts')).toContain(`export * from './components/XgQuickForm'`)
  })
})

describe('replaceMarkedBlock', () => {
  it('без открывающего маркера — ошибка с именем файла', () => {
    expect(() => replaceMarkedBlock('const a = 1\n', ['x'], { namespace: 'ns', file: 'a.ts' }))
      .toThrow(/a\.ts has no opening marker/)
  })

  it('без закрывающего маркера — тоже ошибка', () => {
    expect(() => replaceMarkedBlock('// <ns>\n', ['x'], { namespace: 'ns', file: 'a.ts' }))
      .toThrow(/has no closing marker/)
  })

  it('обе ошибки — GranularCodegenError с машиночитаемой причиной', () => {
    const missingOpen = () => replaceMarkedBlock('const a = 1\n', ['x'], { namespace: 'ns', file: 'a.ts' })

    expect(missingOpen).toThrow(GranularCodegenError)
    expect(missingOpen).toThrow(expect.objectContaining({ reason: 'missing-open-marker', file: 'a.ts' }))
  })

  it('пустой список оставляет блок пустым, а не ломает маркеры', () => {
    const source = '// <ns>\nстарое\n// </ns>\n'

    const next = replaceMarkedBlock(source, [], { namespace: 'ns', file: 'a.ts' })

    expect(next).toBe('// <ns>\n\n// </ns>\n')
  })
})
