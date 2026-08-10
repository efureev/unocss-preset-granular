import { createGenerator } from '@unocss/core'
import { describe, expect, it } from 'vitest'

import { objectRules } from '../index'

async function generate(className: string) {
  const uno = await createGenerator({ rules: objectRules })
  const { css } = await uno.generate(className)
  return css
}

describe('objectRules', () => {
  it.each([
    ['object-cover', 'object-fit:cover'],
    ['object-contain', 'object-fit:contain'],
    ['object-fill', 'object-fit:fill'],
    ['object-scale-down', 'object-fit:scale-down'],
    ['object-none', 'object-fit:none'],
  ])('%s → %s', async (className, expected) => {
    expect(await generate(className)).toContain(expected)
  })

  it.each([
    ['object-center', 'object-position:center'],
    ['object-top', 'object-position:top'],
    ['object-top-left', 'object-position:top left'],
    // Короткие алиасы `positionMap`: `rb` → `right bottom`.
    ['object-rb', 'object-position:right bottom'],
    // Bracket-синтаксис: `_` — разделитель значений в имени класса.
    ['object-[50%_20%]', 'object-position:50% 20%'],
  ])('%s → %s', async (className, expected) => {
    expect(await generate(className)).toContain(expected)
  })

  // Жадное `/^object-(.+)$/` стоит в массиве ПОСЛЕ статик-значений
  // `object-fit`. Проглотить их оно не может: UnoCSS держит строковые правила
  // в отдельной статик-карте, которую `parseUtil` смотрит раньше динамических.
  // Тест держит этот инвариант явным — иначе поломка будет не падением, а
  // подменой `object-fit` на `object-position` в CSS у потребителя.
  it('статик-значения object-fit не перехватываются жадным правилом', async () => {
    const css = await generate('object-cover object-contain')
    expect(css).toContain('object-fit:cover')
    expect(css).toContain('object-fit:contain')
    expect(css).not.toContain('object-position')
  })

  it('несопоставимое значение не эмитит CSS, а не падает', async () => {
    expect(await generate('object-nonsense')).not.toContain('object-position')
  })
})
