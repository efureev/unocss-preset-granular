#!/usr/bin/env node
import process from 'node:process'

import { runGranularCli } from './cli'

/**
 * Точка входа CLI. Вся логика — в `./cli.ts`: этот модуль исполняется на
 * импорте (шебанг + запуск), поэтому тестировать его напрямую нельзя.
 */
runGranularCli(process.argv.slice(2), {
  stdout: text => void process.stdout.write(text),
  stderr: text => void process.stderr.write(text),
})
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    process.stderr.write(`[granular] ${(error as Error)?.message ?? error}\n`)
    process.exitCode = 1
  })
