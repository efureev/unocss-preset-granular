import { createGenerator } from '@unocss/core'
import { describe, expect, it } from 'vitest'

import { colorOpacityRules } from '../index'

async function generate(className: string) {
  const uno = await createGenerator({ rules: colorOpacityRules })
  const { css } = await uno.generate(className)
  return css
}

describe('colorOpacityRules', () => {
  it('bg-[color]/NN эмитит color-mix с процентом', async () => {
    const css = await generate('bg-[#0ea5e9]/30')
    expect(css).toContain('color-mix(in srgb, #0ea5e9 30%, transparent)')
  })

  it('/150 клампится до 100%, а не переполняет color-mix', async () => {
    const css = await generate('bg-[#0ea5e9]/150')
    expect(css).toContain('color-mix(in srgb, #0ea5e9 100%, transparent)')
  })

  it('отрицательная opacity (/-10) не матчит правило вовсе', async () => {
    const css = await generate('bg-[#0ea5e9]/-10')
    expect(css).not.toContain('color-mix')
  })

  it('border-[color]/NN эмитит border-color через color-mix', async () => {
    const css = await generate('border-[var(--brd)]/50')
    expect(css).toContain('border-color:color-mix(in srgb, var(--brd) 50%, transparent)')
  })

  it('bg-[color:red]/NN снимает префикс color: перед color-mix', async () => {
    const css = await generate('bg-[color:red]/40')
    expect(css).toContain('color-mix(in srgb, red 40%, transparent)')
  })

  it('bg-[color:]/NN (пустое значение после префикса) не матчит', async () => {
    const css = await generate('bg-[color:]/40')
    expect(css).not.toContain('color-mix')
  })

  it('border-[color:]/NN (пустое значение после префикса) не матчит', async () => {
    const css = await generate('border-[color:]/40')
    expect(css).not.toContain('color-mix')
  })
})

describe('colorOpacityRules: границы значения opacity', () => {
  it('дробная opacity (/12.5) доезжает до color-mix, а не отбрасывается', async () => {
    const css = await generate('bg-[#0ea5e9]/12.5')
    expect(css).toContain('color-mix(in srgb, #0ea5e9 12.5%, transparent)')
  })

  // Ноль — единственное валидное значение, которое ложно при проверке на
  // truthy. Правило сравнивает с `null`, и этот тест держит это явным:
  // замена на `if (!opacity)` тихо выкинула бы `/0` из CSS.
  it('нулевая opacity (/0) эмитит color-mix, а не выпадает как falsy', async () => {
    const css = await generate('bg-[#0ea5e9]/0')
    expect(css).toContain('color-mix(in srgb, #0ea5e9 0%, transparent)')
  })

  // Граница семейства: правил ровно два, `bg-` и `border-`. Цветовые утилиты
  // presetMini с `/NN` работают сами, а bracket-цвет — только для этих двух.
  it('text-[color]/NN не поддерживается — правила такого нет', async () => {
    expect(await generate('text-[#fff]/50')).not.toContain('color-mix')
  })
})
