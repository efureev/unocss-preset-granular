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
/** Конфиг с лишним провайдером — даёт предупреждение, но не ошибку. */
let warnOptionsFile: string

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

  // Второй провайдер не даёт сборке ничего: ни компонентов, ни темы, ни
  // unocss-вклада — ровно случай `unused-provider`.
  warnOptionsFile = join(root, 'warn.options.mjs')
  writeFileSync(
    warnOptionsFile,
    `const main = {
      id: 'pkg', contractVersion: 1,
      packageBaseUrl: ${JSON.stringify(mkPackage('warn-pkg', true))},
      components: [{ name: 'Btn', safelist: ['btn'] }],
    }
    const empty = { id: 'empty', contractVersion: 1, packageBaseUrl: 'file:///empty/', components: [] }
    export default { providers: [main, empty], components: 'all' }
    `,
    'utf8',
  )
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
    expect(await runGranularCli(['diagnose'], io)).toBe(1)
    expect(err.join('')).toContain(`Unknown command 'diagnose'`)
    expect(err.join('')).toContain('Usage:')
    expect(out).toEqual([])
  })

  it('doctor без options-файла — код 1', async () => {
    const { io, err } = createIo()
    expect(await runGranularCli(['doctor'], io)).toBe(1)
    expect(err.join('')).toContain('Missing <options-file>')
  })

  it('explain и why-css без своего аргумента — код 1', async () => {
    for (const [command, expected] of [
      ['explain', '<providerId:Component>'],
      ['why-css', '<class>'],
    ]) {
      const { io, err } = createIo()
      expect(await runGranularCli([command, okOptionsFile], io)).toBe(1)
      expect(err.join('')).toContain(`Missing ${expected}`)
    }
  })

  it('флаг перед позиционным аргументом разбирается как флаг', async () => {
    const { io, out } = createIo()
    expect(await runGranularCli(['doctor', '--json', okOptionsFile], io)).toBe(0)
    expect(JSON.parse(out.join('')).components).toHaveLength(1)
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
    expect(report).toContain('Layout-contract problems')
    expect(report).toContain('index.js is missing')
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
    expect(err.join('')).toContain(`must export the granular options`)
  })
})

describe('granular CLI: doctor --json / --strict', () => {
  it('--json печатает разбираемый отчёт вместо текста', async () => {
    const { io, out } = createIo()
    expect(await runGranularCli(['doctor', okOptionsFile, '--json'], io)).toBe(0)

    const report = JSON.parse(out.join(''))
    expect(report.ok).toBe(true)
    expect(report.clean).toBe(true)
    expect(report.diagnostics).toEqual([])
    expect(report.components[0].key).toBe('pkg:Btn')
  })

  it('--json на сломанном конфиге отдаёт диагностику уровня error', async () => {
    const { io, out } = createIo()
    expect(await runGranularCli(['doctor', brokenOptionsFile, '--json'], io)).toBe(1)

    const report = JSON.parse(out.join(''))
    expect(report.ok).toBe(false)
    expect(report.diagnostics).toEqual([
      expect.objectContaining({ level: 'error', code: 'layout-contract', subject: 'pkg:Btn' }),
    ])
  })

  it('предупреждение без --strict — код 0, с --strict — код 1', async () => {
    const { io: io1, out } = createIo()
    expect(await runGranularCli(['doctor', warnOptionsFile], io1)).toBe(0)
    expect(out.join('')).toContain('unused-provider')
    expect(out.join('')).toContain('they only fail with --strict')

    const { io: io2 } = createIo()
    expect(await runGranularCli(['doctor', warnOptionsFile, '--strict'], io2)).toBe(1)
  })

  it('--strict не меняет код выхода, когда предупреждений нет', async () => {
    const { io } = createIo()
    expect(await runGranularCli(['doctor', okOptionsFile, '--strict'], io)).toBe(0)
  })
})

describe('granular CLI: explain', () => {
  it('известный компонент — отчёт и код 0', async () => {
    const { io, out } = createIo()
    expect(await runGranularCli(['explain', okOptionsFile, 'pkg:Btn'], io)).toBe(0)

    const text = out.join('')
    expect(text).toContain('granular explain pkg:Btn')
    expect(text).toContain('in the build')
    expect(text).toContain('btn')
  })

  it('короткое имя резолвится, пока оно однозначно', async () => {
    const { io, out } = createIo()
    expect(await runGranularCli(['explain', okOptionsFile, 'Btn', '--json'], io)).toBe(0)
    expect(JSON.parse(out.join('')).key).toBe('pkg:Btn')
  })

  it('неизвестный компонент — код 1 и список известных', async () => {
    const { io, out } = createIo()
    expect(await runGranularCli(['explain', okOptionsFile, 'pkg:Nope'], io)).toBe(1)
    expect(out.join('')).toContain('pkg:Btn')
  })
})

describe('granular CLI: why-css', () => {
  it('класс из safelist — источник найден, код 0', async () => {
    const { io, out } = createIo()
    expect(await runGranularCli(['why-css', okOptionsFile, 'btn'], io)).toBe(0)

    const text = out.join('')
    expect(text).toContain('component safelist')
    expect(text).toContain('pkg:Btn')
  })

  it('класс без источника — код 1 и подсказка про rules', async () => {
    const { io, out } = createIo()
    expect(await runGranularCli(['why-css', okOptionsFile, 'no-such-class'], io)).toBe(1)
    expect(out.join('')).toContain('No sources found')
  })

  it('--json отдаёт структурированные hits', async () => {
    const { io, out } = createIo()
    expect(await runGranularCli(['why-css', okOptionsFile, 'btn', '--json'], io)).toBe(0)

    const report = JSON.parse(out.join(''))
    expect(report.found).toBe(true)
    expect(report.hits[0]).toEqual({ via: 'safelist', providerId: 'pkg', componentName: 'Btn' })
  })
})

describe('granular CLI: tokens', () => {
  it('печатает отчёт и выходит с 0', async () => {
    const { io, out } = createIo()
    const code = await runGranularCli(['tokens', okOptionsFile, 'pkg:Btn'], io)

    expect(code).toBe(0)
    expect(out.join('')).toContain('granular tokens pkg:Btn')
    expect(out.join('')).toContain('Uses (')
  })

  it('короткая форма имени резолвится', async () => {
    const { io, out } = createIo()
    expect(await runGranularCli(['tokens', okOptionsFile, 'Btn', '--json'], io)).toBe(0)
    expect(JSON.parse(out.join('')).key).toBe('pkg:Btn')
  })

  it('--deep расширяет scope', async () => {
    const { io, out } = createIo()
    await runGranularCli(['tokens', okOptionsFile, 'pkg:Btn', '--deep', '--json'], io)
    expect(JSON.parse(out.join('')).scope).toBe('deep')
  })

  it('неизвестное имя даёт 1 и список известных', async () => {
    const { io, out } = createIo()
    const code = await runGranularCli(['tokens', okOptionsFile, 'pkg:Nope'], io)

    expect(code).toBe(1)
    expect(out.join('')).toContain('Known components')
  })

  it('без имени компонента — ошибка использования', async () => {
    const { io, err } = createIo()
    expect(await runGranularCli(['tokens', okOptionsFile], io)).toBe(1)
    expect(err.join('')).toContain('<providerId:Component>')
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
