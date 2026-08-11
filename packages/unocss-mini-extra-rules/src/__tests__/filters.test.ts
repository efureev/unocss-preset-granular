import { createGenerator } from '@unocss/core'
import presetMini, { theme } from '@unocss/preset-mini'
import { describe, expect, it } from 'vitest'

import { filterRules } from '../index'

async function generate(className: string) {
  const uno = await createGenerator({ rules: filterRules, theme })
  const { css } = await uno.generate(className)
  return css
}

// Регрессия на BLOCKER из AUDIT-unocss-mini-extra-rules.md: `percentWithDefault`
// сравнивал `h.percent()` (безразмерная дробь) так, будто это `%`-строка, и
// `-100` вообще не матчил, а `-150` (который обязан быть отклонён клампом)
// проходил. Таблица порогов — из репродукции в аудите.
describe.each([
  ['grayscale', '--un-grayscale'],
  ['invert', '--un-invert'],
  ['sepia', '--un-sepia'],
])('%s-N: клампинг на границе 100%%', (name, cssVar) => {
  it.each([
    [50, true],
    [100, true],
    [101, false],
    [150, false],
    [199, false],
    [250, false],
    [999, false],
    [1000, false],
    [5000, false],
  ])(`${name}-%i → %s`, async (n, shouldMatch) => {
    const css = await generate(`${name}-${n}`)
    if (shouldMatch)
      expect(css).toContain(cssVar)
    else
      expect(css).not.toContain(cssVar)
  })

  it(`backdrop-${name}-100 матчит, backdrop-${name}-150 — нет`, async () => {
    const backdropVar = `--un-backdrop-${name}`
    expect(await generate(`backdrop-${name}-100`)).toContain(backdropVar)
    expect(await generate(`backdrop-${name}-150`)).not.toContain(backdropVar)
  })

  it(`голый ${name} (без суффикса) эмитит 100%-эффект`, async () => {
    const css = await generate(name)
    expect(css).toContain(cssVar)
    expect(css).toContain(`${name}(1)`)
  })

  it(`${name}-[150%] обходит кламп через bracket-значение`, async () => {
    const css = await generate(`${name}-[150%]`)
    expect(css).toContain(cssVar)
  })
})

describe('остальные filter/backdrop-filter утилиты', () => {
  it('blur-md резолвит из темы, blur-[10px] — из bracket-значения', async () => {
    expect(await generate('blur-md')).toContain('--un-blur:blur(')
    expect(await generate('blur-[10px]')).toContain('--un-blur:blur(10px)')
  })

  it('backdrop-blur-md уходит в --un-backdrop-blur и backdrop-filter', async () => {
    const css = await generate('backdrop-blur-md')
    expect(css).toContain('--un-backdrop-blur:blur(')
    expect(css).toContain('backdrop-filter:')
  })

  it('brightness-/contrast-/saturate-N резолвятся в проценты-дроби', async () => {
    expect(await generate('brightness-50')).toContain('--un-brightness:brightness(0.5)')
    expect(await generate('contrast-125')).toContain('--un-contrast:contrast(1.25)')
    expect(await generate('saturate-200')).toContain('--un-saturate:saturate(2)')
    expect(await generate('backdrop-saturate-200')).toContain('--un-backdrop-saturate:saturate(2)')
  })

  it('hue-rotate-90 резолвится в градусы', async () => {
    expect(await generate('hue-rotate-90')).toContain('--un-hue-rotate:hue-rotate(90deg)')
  })

  it('backdrop-opacity-50 резолвится в проценты-дробь', async () => {
    expect(await generate('backdrop-opacity-50')).toContain('--un-backdrop-opacity:opacity(0.5)')
  })

  it('drop-shadow без значения использует DEFAULT из темы', async () => {
    const css = await generate('drop-shadow')
    expect(css).toContain('--un-drop-shadow:drop-shadow(')
  })

  it('drop-shadow-none сбрасывает фильтр', async () => {
    const css = await generate('drop-shadow-none')
    expect(css).toContain('--un-drop-shadow:')
  })

  it('drop-shadow-color-red резолвит именно цвет тени', async () => {
    const css = await generate('drop-shadow-color-red')
    expect(css).toContain('--un-drop-shadow-color')
  })

  it('drop-shadow-red (без -color-) тоже резолвится как цвет через hasParseableColor', async () => {
    const css = await generate('drop-shadow-red')
    expect(css).toContain('--un-drop-shadow-color')
  })

  it('drop-shadow-[0_1px_2px_red] резолвится как произвольное bracket-значение', async () => {
    const css = await generate('drop-shadow-[0_1px_2px_red]')
    expect(css).toContain('--un-drop-shadow:drop-shadow(')
  })

  it('drop-shadow-bogus не матчит (ни тема, ни цвет, ни bracket)', async () => {
    const css = await generate('drop-shadow-bogus')
    expect(css).not.toContain('--un-drop-shadow')
  })

  it('drop-shadow-opacity-50 задаёт --un-drop-shadow-opacity', async () => {
    const css = await generate('drop-shadow-opacity-50')
    expect(css).toContain('--un-drop-shadow-opacity')
  })

  it('filter / filter-none собирают итоговое свойство filter из --un-* переменных', async () => {
    expect(await generate('filter')).toContain('filter:var(--un-blur,)')
    expect(await generate('filter-none')).toContain('filter:none')
  })

  it('backdrop-filter / backdrop-filter-none собирают -webkit- и обычный backdrop-filter', async () => {
    const css = await generate('backdrop-filter')
    expect(css).toContain('-webkit-backdrop-filter:')
    expect(css).toContain('backdrop-filter:')
    expect(await generate('backdrop-filter-none')).toContain('backdrop-filter:none')
  })

  it('глобальные ключевые слова (filter-inherit, backdrop-filter-initial) проходят как есть', async () => {
    expect(await generate('filter-inherit')).toContain('filter:inherit')
    expect(await generate('backdrop-filter-initial')).toContain('backdrop-filter:initial')
  })
})

describe('@property под variablePrefix пресета', () => {
  async function generateWithPrefix(className: string) {
    const uno = await createGenerator({
      presets: [presetMini({ variablePrefix: 'ds-' })],
      rules: filterRules,
    })
    const { css } = await uno.generate(className)
    return css
  }

  // Имя регистрируемого свойства живёт в селекторе (`@property --un-blur`), а
  // `postprocess` пресета правит только `entries`. Разъехавшись, `@property`
  // регистрирует переменную, к которой никто не обращается: из-за fallback'а в
  // `var(--ds-blur,)` фильтр работает, но `inherits: false` теряется — дочерний
  // элемент со своим фильтром подхватывает родительское значение.
  it('регистрируется то же имя, на которое ссылается утилита', async () => {
    const css = await generateWithPrefix('blur-4')
    expect(css).toContain('--ds-blur:blur(4px)')
    expect(css).toContain('@property --ds-blur')
    expect(css).not.toContain('@property --un-blur')
  })

  it('то же для backdrop-семейства', async () => {
    const css = await generateWithPrefix('backdrop-blur-md')
    expect(css).toContain('@property --ds-backdrop-blur')
    expect(css).not.toContain('@property --un-backdrop-blur')
  })

  it('без variablePrefix имена остаются `--un-*`', async () => {
    const css = await generate('blur-4')
    expect(css).toContain('@property --un-blur')
  })
})
