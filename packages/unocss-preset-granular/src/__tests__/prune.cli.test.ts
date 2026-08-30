import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { runGranularCli } from '../cli'

let root: string
let optionsFile: string
let deadPatternOptionsFile: string
let declaredElsewhereOptionsFile: string

function createIo(): { io: { stdout: (t: string) => void, stderr: (t: string) => void }, out: string[], err: string[] } {
  const out: string[] = []
  const err: string[] = []
  return { io: { stdout: t => out.push(t), stderr: t => err.push(t) }, out, err }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'granular-prune-cli-'))
  const dist = join(root, 'dist')
  mkdirSync(join(dist, 'components/Btn'), { recursive: true })
  writeFileSync(join(dist, 'components/Btn/index.js'), '', 'utf8')
  writeFileSync(join(dist, 'tokens.css'), ':root { --used: 1px; --dead: 2px }\n', 'utf8')
  writeFileSync(join(dist, 'base.css'), 'body { margin: 0 }\n', 'utf8')

  // Общий модуль ВНЕ скан-директорий: имя токена лежит литералом, а `var()`
  // собирается тут же в рантайме. Ни один статический канал такое не видит.
  mkdirSync(join(dist, 'internal'), { recursive: true })
  writeFileSync(
    join(dist, 'internal', 'z.js'),
    `const NAME = '--dead'\nexport const z = \`var($${'{'}NAME})\`\n`,
    'utf8',
  )
  // Зеркало реестра токенов: имена есть, сборки `var()` нет. Не находка —
  // иначе диагностика срабатывала бы на каждый удаляемый токен.
  writeFileSync(
    join(dist, 'internal', 'registry.js'),
    'export const all = [\'--used\', \'--dead\']\n',
    'utf8',
  )

  const baseUrl = pathToFileURL(`${dist}/`).href
  optionsFile = join(root, 'granular.options.mjs')
  writeFileSync(optionsFile, [
    'const provider = {',
    '  id: \'pkg\', contractVersion: 1,',
    `  packageBaseUrl: ${JSON.stringify(baseUrl)},`,
    '  components: [{ name: \'Btn\', safelist: [\'p-[var(--used)]\'] }],',
    '  theme: {',
    `    tokensCssUrl: ${JSON.stringify(new URL('tokens.css', baseUrl).href)},`,
    `    baseCssUrl: ${JSON.stringify(new URL('base.css', baseUrl).href)},`,
    '  },',
    '}',
    'export default { providers: [provider], components: \'all\' }',
    '',
  ].join('\n'), 'utf8')

  // Тот же пакет, но `--dead` объявлен вторым компонентом, которого нет в
  // селекции: находкой он быть не должен.
  declaredElsewhereOptionsFile = join(root, 'declared-elsewhere.options.mjs')
  writeFileSync(declaredElsewhereOptionsFile, [
    'const provider = {',
    '  id: \'pkg\', contractVersion: 1,',
    `  packageBaseUrl: ${JSON.stringify(baseUrl)},`,
    '  components: [',
    '    { name: \'Btn\', safelist: [\'p-[var(--used)]\'] },',
    '    { name: \'Other\', dynamicTokens: [\'dead\'] },',
    '  ],',
    '  theme: {',
    `    tokensCssUrl: ${JSON.stringify(new URL('tokens.css', baseUrl).href)},`,
    `    baseCssUrl: ${JSON.stringify(new URL('base.css', baseUrl).href)},`,
    '  },',
    '}',
    'export default { providers: [provider], components: [{ provider: \'pkg\', names: [\'Btn\'] }] }',
    '',
  ].join('\n'), 'utf8')

  deadPatternOptionsFile = join(root, 'dead.options.mjs')
  writeFileSync(deadPatternOptionsFile, [
    `const base = await import(${JSON.stringify(pathToFileURL(optionsFile).href)})`,
    'export default { ...base.default, pruneTokens: { mode: \'report\', keep: [\'typo-*\'] } }',
    '',
  ].join('\n'), 'utf8')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('granular prune', () => {
  it('печатает, что было бы удалено, и что сохранено', async () => {
    const { io, out } = createIo()
    const code = await runGranularCli(['prune', optionsFile], io)
    const text = out.join('')

    expect(code).toBe(0)
    expect(text).toContain('granular prune')
    expect(text).toContain('--dead')
    expect(text).toContain('--used')
  })

  it('при выключенной обрезке говорит, что список гипотетический', async () => {
    // Иначе «Removed» читается как отчёт о сделанном, а эмиссия при этом
    // не изменилась ни на байт.
    const { io, out } = createIo()
    await runGranularCli(['prune', optionsFile], io)
    expect(out.join('')).toContain('trimming is disabled')
  })

  it('честно сообщает, что исходники приложения не сканировались', async () => {
    // Самый частый способ потерять токен — включить обрезку, не показав
    // пресету разметку приложения. Строка обязана быть в каждом отчёте.
    const { io, out } = createIo()
    await runGranularCli(['prune', optionsFile], io)
    expect(out.join('')).toContain('Application sources: not configured')
  })

  it('предупреждает про удаляемый токен, чьё имя собирается вне скана', async () => {
    const { io, out } = createIo()
    await runGranularCli(['prune', optionsFile], io)
    const text = out.join('')
    expect(text).toContain('outside the scanned directories')
    expect(text).toContain('internal/z.js')
  })

  it('зеркало реестра токенов находкой НЕ считается', async () => {
    // Имена там есть, но `var()` не собирается. Без этого условия на реальной
    // дизайн-системе находкой становится каждый удаляемый токен: измерено на
    // `@feugene/granularity` — 195 из 195.
    const { io, out } = createIo()
    await runGranularCli(['prune', optionsFile, '--json'], io)
    const report = JSON.parse(out.join(''))
    expect(report.suspects.map((x: { file: string }) => x.file)).not.toContain('internal/registry.js')
  })

  it('предупреждает про шаблон keep, не совпавший ни с чем', async () => {
    const { io, out } = createIo()
    await runGranularCli(['prune', deadPatternOptionsFile], io)
    const text = out.join('')
    expect(text).toContain('Patterns matching nothing declared')
    expect(text).toContain('typo-*')
  })

  it('токен, объявленный НЕвыбранным компонентом, находкой не считается', async () => {
    // Имя лежит в общем чанке, но владелец его объявил — он просто не попал в
    // эту селекцию, и удалён токен правильно. Без этого условия диагностика
    // шумит там, где всё сделано верно: измерено на `@feugene/granularity` —
    // у приложения с одним `GrCard` находками становились оба токена шкалы
    // слоёв, объявленные восемью оверлейными компонентами.
    const { io, out } = createIo()
    await runGranularCli(['prune', declaredElsewhereOptionsFile, '--json'], io)
    const report = JSON.parse(out.join(''))
    expect(report.removed).toContain('dead')
    expect(report.suspects).toEqual([])
  })

  it('--json отдаёт разбираемую структуру', async () => {
    const { io, out } = createIo()
    await runGranularCli(['prune', optionsFile, '--json'], io)
    const report = JSON.parse(out.join(''))
    expect(report.mode).toBe('off')
    expect(report.removed).toContain('dead')
    expect(report.kept.map((k: { token: string }) => k.token)).toContain('used')
    expect(report.files.some((f: { skipped: boolean }) => f.skipped)).toBe(true)
  })

  it('--strict роняет прогон, когда есть что удалять', async () => {
    const { io } = createIo()
    expect(await runGranularCli(['prune', optionsFile, '--strict'], io)).toBe(1)
  })

  it('без --strict непустой список кодом выхода не считается', async () => {
    const { io } = createIo()
    expect(await runGranularCli(['prune', optionsFile], io)).toBe(0)
  })

  it('файл опций обязателен', async () => {
    const { io, err } = createIo()
    expect(await runGranularCli(['prune'], io)).toBe(1)
    expect(err.join('')).toContain('Missing <options-file>')
  })

  it('команда есть в usage', async () => {
    const { io, out } = createIo()
    await runGranularCli(['help'], io)
    expect(out.join('')).toContain('granular prune')
  })
})
