import type { PresetGranularNodeOptions } from './preset.node'

import { resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { countDoctorDiagnostics, formatDoctorReport, granularDoctor } from './doctor'
import { formatExplainReport, granularExplain } from './explain'
import { formatTokenPruneReport, granularTokenPrune } from './prune'
import { formatTokensReport, granularTokens } from './tokens'
import { formatWhyCssReport, granularWhyCss } from './why-css'

export const GRANULAR_CLI_USAGE = `granular — diagnostics for @feugene/unocss-preset-granular

Usage:
  granular doctor  <options-file> [--json] [--strict]
  granular explain <options-file> <providerId:Component> [--json]
  granular why-css <options-file> <class> [--json]
  granular tokens  <options-file> <providerId:Component> [--deep] [--json]
  granular prune   <options-file> [--json] [--strict]

  <options-file> is a JS/MJS module exporting the granular options
  (default / \`granularOptions\` / \`options\`) with a \`providers\` array.
  Usually the options are extracted from uno.config.ts into their own file:

    // granular.options.mjs
    import provider from '@your/pkg/granular-provider/node'
    export default { providers: [provider], components: 'all' }

  Then:  granular doctor ./granular.options.mjs

Commands:
  doctor   — full report on the configuration: providers, the component graph,
             themes, token conflicts, scan globs, layout-contract violations.
  explain  — why a component is in the build: the chain from the selection
             root, reverse dependencies and its safelist/CSS/token
             contribution. The provider prefix may be omitted when the
             component name is unambiguous.
  why-css  — which component pulled a class into the final CSS: safelist,
             component CSS files, sources in content.filesystem.
  prune    — which tokens the emitted CSS could drop: what would be removed
             from tokens.css and the theme files, what is kept and why, and
             the resulting byte delta. Reads the configuration only; it never
             changes the emission. Enable the trimming itself with
             \`pruneTokens.mode\` in the preset options.
             --strict exits 1 when anything would be removed.
  tokens   — which theme tokens a component declares and consumes: where each
             value comes from layer by layer, which tokens are shared with
             other components, and which are defined by no layer at all.

Flags:
  --json    print a structured report instead of text.
  --strict  (doctor only) treat warnings as errors.
  --deep    (tokens only) include tokens of the component's dependencies.

Exit codes: 0 — OK, 1 — violations found or an error occurred.
`

/** Куда CLI пишет вывод. Инъекция нужна тестам, в проде — потоки процесса. */
export interface GranularCliIo {
  stdout: (text: string) => void
  stderr: (text: string) => void
}

/** Файл опций не экспортирует того, что CLI обязан в нём найти. */
export class GranularOptionsLoadError extends Error {
  constructor(public readonly file: string) {
    super(
      `Module '${file}' must export the granular options `
      + `(default / granularOptions / options) with a 'providers' array.`,
    )
    this.name = 'GranularOptionsLoadError'
  }
}

/**
 * Загружает granular-опции из пользовательского модуля.
 *
 * Принимаются три формы экспорта — `default`, `granularOptions`, `options`:
 * приложение обычно уже держит опции отдельной константой, чтобы передать
 * один и тот же объект в `presetGranularNode` и `granularContent`.
 */
export async function loadGranularOptions(file: string): Promise<PresetGranularNodeOptions> {
  const url = pathToFileURL(resolve(file)).href
  const mod = await import(url)
  const options = mod.default ?? mod.granularOptions ?? mod.options
  if (!options || !Array.isArray(options.providers))
    throw new GranularOptionsLoadError(file)
  return options as PresetGranularNodeOptions
}

interface ParsedArgs {
  command?: string
  positionals: string[]
  flags: Set<string>
}

/**
 * Разбирает аргументы на команду, позиционные значения и флаги.
 *
 * Флаги допускаются в любом месте строки: `granular doctor --json ./opts.mjs`
 * — ровно то, что человек напечатает по привычке, и разбор «по позиции»
 * принял бы `--json` за путь к файлу.
 */
function parseArgs(args: readonly string[]): ParsedArgs {
  const positionals: string[] = []
  const flags = new Set<string>()

  for (const arg of args) {
    if (arg.startsWith('--'))
      flags.add(arg)
    else
      positionals.push(arg)
  }

  return { command: positionals.shift(), positionals, flags }
}

/** Печатает отчёт как JSON или как текст — общая ветка всех команд. */
function emit(io: GranularCliIo, json: boolean, report: unknown, text: () => string): void {
  io.stdout(json ? `${JSON.stringify(report, null, 2)}\n` : `${text()}\n`)
}

/**
 * Тело CLI: разбирает аргументы (уже без `node` и пути к скрипту), пишет в
 * `io` и возвращает код выхода. Ничего не завершает сам — процессом
 * управляет `bin.ts`.
 *
 * Вынесено из `bin.ts` именно ради тестируемости: тот модуль исполняется на
 * импорте, поэтому проверить его поведение можно было только запуском
 * подпроцесса.
 */
export async function runGranularCli(
  args: readonly string[],
  io: GranularCliIo,
): Promise<number> {
  const { command, positionals, flags } = parseArgs(args)
  const [file, subject] = positionals
  const json = flags.has('--json')

  // `--help` попадает во flags, `-h`/`help` — в позиционные: спрашивают
  // справку всеми тремя способами, и все три обязаны работать.
  if (flags.has('--help') || command === '-h' || command === 'help') {
    io.stdout(GRANULAR_CLI_USAGE)
    return 0
  }

  if (!command) {
    // Без аргументов — это ошибка использования, с явным `help` — не ошибка.
    io.stdout(GRANULAR_CLI_USAGE)
    return 1
  }

  if (command !== 'doctor' && command !== 'explain' && command !== 'why-css' && command !== 'tokens' && command !== 'prune') {
    io.stderr(`Unknown command '${command}'.\n\n${GRANULAR_CLI_USAGE}`)
    return 1
  }

  if (!file) {
    io.stderr(`Missing <options-file>.\n\n${GRANULAR_CLI_USAGE}`)
    return 1
  }

  // Карта, а не тернарник: к четвёртой команде цепочка «?:» стала нечитаемой.
  const SUBJECT_LABEL: Record<string, string | undefined> = {
    'doctor': undefined,
    'explain': '<providerId:Component>',
    'tokens': '<providerId:Component>',
    'prune': undefined,
    'why-css': '<class>',
  }

  const subjectLabel = SUBJECT_LABEL[command]
  if (subjectLabel !== undefined && !subject) {
    io.stderr(`Missing ${subjectLabel} for '${command}'.\n\n${GRANULAR_CLI_USAGE}`)
    return 1
  }

  try {
    const options = await loadGranularOptions(file)

    if (command === 'explain') {
      const report = granularExplain(options, subject)
      emit(io, json, report, () => formatExplainReport(report))
      // Неизвестный компонент — ошибка ввода; «не в сборке» это валидный ответ.
      return report.reason === 'unknown' ? 1 : 0
    }

    if (command === 'tokens') {
      const report = granularTokens(options, subject, flags.has('--deep') ? 'deep' : 'own')
      emit(io, json, report, () => formatTokensReport(report, process.cwd()))
      // Неизвестное имя — ошибка ввода. «Токенов нет» и «токен не определён» —
      // валидные ответы: гейтом для CI служит `doctor --strict`.
      return report.available ? 1 : 0
    }

    if (command === 'prune') {
      const report = await granularTokenPrune(options)
      emit(io, json, report, () => formatTokenPruneReport(report, process.cwd()))
      // Гейт «фундамент вычищен»: непустой список удаляемого означает, что в
      // CSS уезжают токены, которых никто не потребляет.
      return flags.has('--strict') && report.removed.length > 0 ? 1 : 0
    }

    if (command === 'why-css') {
      const report = await granularWhyCss(options, subject)
      emit(io, json, report, () => formatWhyCssReport(report, process.cwd()))
      // Ненайденный источник — ответ «никакой компонент», и он же полезен как
      // ассерт в CI: «этот класс больше не приходит из пакета».
      return report.found ? 0 : 1
    }

    const report = granularDoctor(options)
    emit(io, json, report, () => formatDoctorReport(report))
    if (!report.ok)
      return 1
    return flags.has('--strict') && countDoctorDiagnostics(report).warnings > 0 ? 1 : 0
  }
  catch (error) {
    io.stderr(`[granular] ${(error as Error)?.message ?? error}\n`)
    return 1
  }
}
