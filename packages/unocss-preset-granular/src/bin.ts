#!/usr/bin/env node
import { resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import type { PresetGranularNodeOptions } from './preset.node'
import { formatDoctorReport, granularDoctor } from './doctor'

const USAGE = `granular — диагностика @feugene/unocss-preset-granular

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

async function loadOptions(file: string): Promise<PresetGranularNodeOptions> {
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

async function main(): Promise<number> {
  const [command, file] = process.argv.slice(2)

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(USAGE)
    return command ? 0 : 1
  }

  if (command !== 'doctor') {
    process.stderr.write(`Неизвестная команда '${command}'.\n\n${USAGE}`)
    return 1
  }

  if (!file) {
    process.stderr.write(`Не указан <options-file>.\n\n${USAGE}`)
    return 1
  }

  const options = await loadOptions(file)
  const report = granularDoctor(options)
  process.stdout.write(`${formatDoctorReport(report)}\n`)
  return report.ok ? 0 : 1
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    process.stderr.write(`[granular] ${(error as Error)?.message ?? error}\n`)
    process.exitCode = 1
  })
