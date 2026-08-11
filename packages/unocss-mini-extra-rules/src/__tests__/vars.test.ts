import type { UtilObject } from '@unocss/core'

import { createGenerator } from '@unocss/core'
import { describe, expect, it } from 'vitest'

import { numericPreflights, numericRules } from '../index'

/**
 * `postprocessEntries` тестируется через `numericPreflights` — единственный
 * публичный путь к нему. Проверяется форма контракта UnoCSS: постпроцессор
 * может мутировать утилиту на месте, вернуть новую или вернуть массив, и все
 * три варианта обязаны доехать до preflight'а — иначе переменные в нём
 * разъедутся с теми, на которые ссылаются утилиты.
 */
async function generate(postprocess: ((util: UtilObject) => any)[]) {
  const uno = await createGenerator({
    rules: numericRules,
    preflights: numericPreflights,
    postprocess,
  })
  const { css } = await uno.generate('tabular-nums')
  return css
}

function renameTo(prefix: string) {
  return (util: UtilObject) => {
    util.entries.forEach((entry) => {
      entry[0] = entry[0].replace(/^--un-/, `--${prefix}`)
    })
  }
}

describe('postprocess в preflight переменных', () => {
  it('мутация на месте — так работает VarPrefixPostprocessor', async () => {
    const css = await generate([renameTo('a-')])
    expect(css).toContain('--a-numeric-spacing: ')
    expect(css).not.toContain('--un-numeric-spacing: ')
  })

  it('возврат нового объекта вместо мутации', async () => {
    const css = await generate([
      (util) => {
        const copy = { ...util, entries: util.entries.map(([n, v]) => [n.replace(/^--un-/, '--b-'), v]) }
        return copy as UtilObject
      },
    ])
    expect(css).toContain('--b-numeric-spacing: ')
  })

  it('возврат массива — берётся первая утилита', async () => {
    const css = await generate([
      (util) => {
        renameTo('c-')(util)
        // Вторую утилиту постпроцессор породил из первой — для блока
        // переменных она лишняя, и preflight обязан взять именно первую.
        return [util, { ...util, selector: '.ignored' }]
      },
    ])
    // Смотрим именно на preflight-слой: утилиты тот же постпроцессор
    // размножит по своим правилам, и `.ignored` там ожидаем.
    const preflight = css.split('/* layer: default */')[0]
    expect(preflight).toContain('--c-numeric-spacing: ')
    expect(preflight).not.toContain('.ignored')
  })

  it('пустой массив и null не роняют preflight — остаётся исходная утилита', async () => {
    expect(await generate([() => []])).toContain('--un-numeric-spacing: ')
    expect(await generate([() => null])).toContain('--un-numeric-spacing: ')
  })
})
