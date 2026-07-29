import type { PresetGranularNodeOptions } from './preset.node'

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { formatDoctorReport, granularDoctor } from './doctor'

export const GRANULAR_CLI_USAGE = `granular — диагностика @feugene/unocss-preset-granular

Использование:
  granular doctor <options-file>

  <options-file> — JS/MJS модуль, экспортирующий granular-опции
  (default / \`granularOptions\` / \`options\`) с массивом \`providers\`.
  Обычно опции выносят из uno.config.ts в отдельный файл:

    // granular.options.mjs
    import provider from '@your/pkg/granular-provider/node'
    export default { providers: [provider], components: 'all' }

  Затем:  granular doctor ./granular.options.mjs

Коды выхода: 0 — OK, 1 — найдены нарушения layout-контракта или ошибка.
`

/** Куда CLI пишет вывод. Инъекция нужна тестам, в проде — потоки процесса. */
export interface GranularCliIo {
  stdout: (text: string) => void
  stderr: (text: string) => void
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
  if (!options || !Array.isArray(options.providers)) {
    throw new Error(
      `Модуль '${file}' должен экспортировать granular-опции `
      + `(default / granularOptions / options) с массивом 'providers'.`,
    )
  }
  return options as PresetGranularNodeOptions
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
  const [command, file] = args

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    io.stdout(GRANULAR_CLI_USAGE)
    // Без аргументов — это ошибка использования, с явным `help` — не ошибка.
    return command ? 0 : 1
  }

  if (command !== 'doctor') {
    io.stderr(`Неизвестная команда '${command}'.\n\n${GRANULAR_CLI_USAGE}`)
    return 1
  }

  if (!file) {
    io.stderr(`Не указан <options-file>.\n\n${GRANULAR_CLI_USAGE}`)
    return 1
  }

  try {
    const options = await loadGranularOptions(file)
    const report = granularDoctor(options)
    io.stdout(`${formatDoctorReport(report)}\n`)
    return report.ok ? 0 : 1
  }
  catch (error) {
    io.stderr(`[granular] ${(error as Error)?.message ?? error}\n`)
    return 1
  }
}
