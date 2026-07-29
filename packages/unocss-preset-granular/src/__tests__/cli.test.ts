import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { GRANULAR_CLI_USAGE, loadGranularOptions, runGranularCli } from '../cli'

let root: string
/** Пакет, чей единственный компонент собран корректно. */
let okOptionsFile: string
/** Пакет, у компонента которого нет `index.js` — нарушение layout-контракта. */
let brokenOptionsFile: string

/** Собирает вывод CLI вместо потоков процесса. */
function createIo(): { io: { stdout: (t: string) => void, stderr: (t: string) => void }, out: string[], err: string[] } {
  const out: string[] = []
  const err: string[] = []
  return { io: { stdout: t => out.push(t), stderr: t => err.push(t) }, out, err }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'granular-cli-'))

  const mkPackage = (name: string, withEntry: boolean): string => {
    const dist = join(root, name, 'dist')
    const componentDir = join(dist, 'components/Btn')
    mkdirSync(componentDir, { recursive: true })
    if (withEntry)
      writeFileSync(join(componentDir, 'index.js'), '', 'utf8')
    return pathToFileURL(`${dist}/`).href
  }

  const writeOptions = (file: string, baseUrl: string, exportName: string): string => {
    const path = join(root, file)
    const provider = `{
      id: 'pkg', contractVersion: 1,
      packageBaseUrl: ${JSON.stringify(baseUrl)},
      components: [{ name: 'Btn', safelist: ['btn'] }],
    }`
    const body = `const options = { providers: [${provider}], components: 'all' }`
    writeFileSync(
      path,
      exportName === 'default'
        ? `${body}\nexport default options\n`
        : `${body}\nexport { options as ${exportName} }\n`,
      'utf8',
    )
    return path
  }

  okOptionsFile = writeOptions('ok.options.mjs', mkPackage('ok-pkg', true), 'default')
  brokenOptionsFile = writeOptions('broken.options.mjs', mkPackage('broken-pkg', false), 'default')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('granular CLI: аргументы', () => {
  it('без аргументов печатает usage и выходит с 1', async () => {
    const { io, out, err } = createIo()
    expect(await runGranularCli([], io)).toBe(1)
    expect(out.join('')).toBe(GRANULAR_CLI_USAGE)
    expect(err).toEqual([])
  })

  it('--help / -h / help печатают usage и выходят с 0', async () => {
    for (const flag of ['--help', '-h', 'help']) {
      const { io, out } = createIo()
      expect(await runGranularCli([flag], io)).toBe(0)
      expect(out.join('')).toBe(GRANULAR_CLI_USAGE)
    }
  })

  it('неизвестная команда — код 1 и usage в stderr', async () => {
    const { io, out, err } = createIo()
    expect(await runGranularCli(['explain'], io)).toBe(1)
    expect(err.join('')).toContain(`Неизвестная команда 'explain'`)
    expect(err.join('')).toContain('Использование:')
    expect(out).toEqual([])
  })

  it('doctor без options-файла — код 1', async () => {
    const { io, err } = createIo()
    expect(await runGranularCli(['doctor'], io)).toBe(1)
    expect(err.join('')).toContain('Не указан <options-file>')
  })
})

describe('granular CLI: doctor', () => {
  it('исправный конфиг — отчёт в stdout и код 0', async () => {
    const { io, out, err } = createIo()
    expect(await runGranularCli(['doctor', okOptionsFile], io)).toBe(0)

    const report = out.join('')
    expect(report).toContain('granular doctor')
    expect(report).toContain('pkg:Btn')
    expect(report).toContain('✓ OK')
    expect(err).toEqual([])
  })

  it('нарушение layout-контракта — код 1 и раздел с проблемами', async () => {
    const { io, out } = createIo()
    expect(await runGranularCli(['doctor', brokenOptionsFile], io)).toBe(1)

    const report = out.join('')
    expect(report).toContain('Проблемы layout-контракта')
    expect(report).toContain('нет index.js')
  })

  it('несуществующий файл — код 1, сообщение вместо стектрейса', async () => {
    const { io, err } = createIo()
    expect(await runGranularCli(['doctor', join(root, 'nope.mjs')], io)).toBe(1)
    expect(err.join('')).toContain('[granular]')
  })

  it('модуль, бросающий не-Error, всё равно даёт внятный вывод и код 1', async () => {
    const throwing = join(root, 'throwing.options.mjs')
    // Модуль бросает СТРОКУ, а не Error — проверяем ветку `?? error`.
    writeFileSync(throwing, 'throw \'boom\'\n', 'utf8')

    const { io, err } = createIo()
    expect(await runGranularCli(['doctor', throwing], io)).toBe(1)
    expect(err.join('')).toBe('[granular] boom\n')
  })

  it('модуль без providers — код 1 и внятное сообщение', async () => {
    const bad = join(root, 'bad.options.mjs')
    writeFileSync(bad, 'export default { components: \'all\' }\n', 'utf8')

    const { io, err } = createIo()
    expect(await runGranularCli(['doctor', bad], io)).toBe(1)
    expect(err.join('')).toContain(`должен экспортировать granular-опции`)
  })
})

describe('loadGranularOptions: формы экспорта', () => {
  it('принимает default, granularOptions и options', async () => {
    const provider = `{ id: 'p', contractVersion: 1, packageBaseUrl: 'file:///p/', components: [] }`
    for (const [file, source] of [
      ['d.mjs', `export default { providers: [${provider}] }`],
      ['g.mjs', `export const granularOptions = { providers: [${provider}] }`],
      ['o.mjs', `export const options = { providers: [${provider}] }`],
    ]) {
      const path = join(root, file)
      writeFileSync(path, `${source}\n`, 'utf8')
      const loaded = await loadGranularOptions(path)
      expect(loaded.providers).toHaveLength(1)
    }
  })

  it('бросает, если providers не массив', async () => {
    const path = join(root, 'no-providers.mjs')
    writeFileSync(path, 'export default { providers: \'nope\' }\n', 'utf8')
    await expect(loadGranularOptions(path)).rejects.toThrow(/providers/)
  })
})
