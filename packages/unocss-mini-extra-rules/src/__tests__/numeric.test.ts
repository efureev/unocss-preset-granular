import { createGenerator } from '@unocss/core'
import presetMini from '@unocss/preset-mini'
import { describe, expect, it } from 'vitest'

import { numericPreflights, numericRules } from '../index'

async function generate(classNames: string) {
  const uno = await createGenerator({ rules: numericRules, preflights: numericPreflights })
  const { css } = await uno.generate(classNames)
  return css
}

describe('numericRules', () => {
  it.each([
    ['ordinal', '--un-ordinal:ordinal'],
    ['slashed-zero', '--un-slashed-zero:slashed-zero'],
    ['lining-nums', '--un-numeric-figure:lining-nums'],
    ['oldstyle-nums', '--un-numeric-figure:oldstyle-nums'],
    ['proportional-nums', '--un-numeric-spacing:proportional-nums'],
    ['tabular-nums', '--un-numeric-spacing:tabular-nums'],
    ['diagonal-fractions', '--un-numeric-fraction:diagonal-fractions'],
    ['stacked-fractions', '--un-numeric-fraction:stacked-fractions'],
  ])('%s → %s', async (className, expected) => {
    expect(await generate(className)).toContain(expected)
  })

  it('каждая утилита собирает свойство из всех пяти переменных', async () => {
    expect(await generate('tabular-nums')).toContain(
      'font-variant-numeric:var(--un-ordinal) var(--un-slashed-zero) var(--un-numeric-figure) var(--un-numeric-spacing) var(--un-numeric-fraction)',
    )
  })

  it('normal-nums сбрасывает свойство целиком, а не по частям', async () => {
    const css = await generate('normal-nums')
    const rule = css.match(/\.normal-nums\{[^}]*\}/)?.[0]
    expect(rule).toBe('.normal-nums{font-variant-numeric:normal;}')
  })
})

describe('композиция — то, ради чего свойство собирается из переменных', () => {
  it('ordinal и tabular-nums переживают друг друга', async () => {
    const css = await generate('ordinal tabular-nums')
    // Обе переменные выставлены — значит ни одно правило не затёрло другое.
    expect(css).toContain('--un-ordinal:ordinal')
    expect(css).toContain('--un-numeric-spacing:tabular-nums')
  })

  it('утилиты одной оси взаимоисключают друг друга через одну переменную', async () => {
    const css = await generate('proportional-nums tabular-nums')
    // Обе пишут `--un-numeric-spacing`; какая победит, решает каскад,
    // а не порядок объявления правил в массиве.
    expect(css).toContain('--un-numeric-spacing:proportional-nums')
    expect(css).toContain('--un-numeric-spacing:tabular-nums')
  })
})

describe('numericPreflights', () => {
  it('объявляет пустые значения по умолчанию на тех же селекторах, что presetMini', async () => {
    const css = await generate('tabular-nums')
    expect(css).toContain('*,::before,::after{')
    expect(css).toContain('::backdrop{')
    for (const name of [
      '--un-ordinal',
      '--un-slashed-zero',
      '--un-numeric-figure',
      '--un-numeric-spacing',
      '--un-numeric-fraction',
    ]) {
      expect(css).toContain(`${name}: `)
    }
  })

  it('без preflight свойство собралось бы из неопределённых переменных', async () => {
    const uno = await createGenerator({ rules: numericRules })
    const { css } = await uno.generate('tabular-nums')
    expect(css).not.toContain('--un-ordinal: ')
  })

  it('переименовывает переменные вслед за variablePrefix — иначе preflight мимо утилит', async () => {
    const uno = await createGenerator({
      presets: [presetMini({ variablePrefix: 'ds-' })],
      rules: numericRules,
      preflights: numericPreflights,
    })
    const { css } = await uno.generate('tabular-nums')

    // Утилита ссылается на `--ds-*` (это делает postprocess пресета) — значит
    // и объявлять по умолчанию нужно `--ds-*`, а не `--un-*`.
    expect(css).toContain('--ds-numeric-spacing:tabular-nums')
    expect(css).toContain('--ds-numeric-spacing: ')
    expect(css).not.toContain('--un-numeric-spacing')
  })
})

describe('preflightRoot', () => {
  // Селекторы сброса принадлежат конфигу, а не правилу: если приложение
  // увело базовые переменные presetMini под свой корень, наш блок обязан
  // уехать туда же, а не остаться прибитым к дефолту.
  it('едет за theme.preflightRoot приложения', async () => {
    const uno = await createGenerator({
      rules: numericRules,
      preflights: numericPreflights,
      theme: { preflightRoot: ['#app'] },
    })
    const { css } = await uno.generate('tabular-nums')

    expect(css).toContain('#app{--un-ordinal: ')
    expect(css).toContain('--un-numeric-spacing: ')
    expect(css).not.toContain('*,::before,::after{')
  })

  it('пустой preflightRoot — блока нет вовсе, как и у presetMini', async () => {
    const uno = await createGenerator({
      rules: numericRules,
      preflights: numericPreflights,
      theme: { preflightRoot: [] },
    })
    const { css } = await uno.generate('tabular-nums')

    expect(css).not.toContain('--un-numeric-spacing: ')
  })
})
