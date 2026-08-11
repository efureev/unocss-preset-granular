import presetMini from '@unocss/preset-mini'
import { createGenerator } from 'unocss'
import { describe, expect, it } from 'vitest'

import { defineGranularProvider } from '../contract'
import { GRANULAR_DEFAULT_LAYER, GRANULAR_DEFAULT_LAYER_ORDER } from '../core/layer'
import { presetGranular } from '../preset'

const provider = defineGranularProvider({
  id: 'ds',
  contractVersion: 1,
  packageBaseUrl: 'file:///ds/',
  components: [
    { name: 'DsButton', safelist: ['ds-button', 'ds-button--primary'] },
    { name: 'DsFormField', safelist: ['ds-form-field'], dependencies: ['DsButton'] },
  ],
  unocss: {
    rules: [[/^custom-(.+)$/, ([, v]) => ({ color: v })]],
    preflights: [{ getCSS: async () => '.inline{color:red}' }],
  },
})

describe('presetGranular', () => {
  it('имя и layer', () => {
    const p = presetGranular({ providers: [provider], layer: 'granular' })
    expect(p.name).toBe('granular-preset')
    expect(p.layer).toBe('granular')
  })

  it('layer по умолчанию — granular, с объявленным порядком', () => {
    const p = presetGranular({ providers: [provider], components: ['ds:DsButton'] })
    expect(p.layer).toBe(GRANULAR_DEFAULT_LAYER)
    expect(p.layers).toEqual({ [GRANULAR_DEFAULT_LAYER]: GRANULAR_DEFAULT_LAYER_ORDER })
    expect(p.preflights?.[0].layer).toBe(GRANULAR_DEFAULT_LAYER)
  })

  it('кастомное имя слоя — порядок объявляется для него же', () => {
    const p = presetGranular({ providers: [provider], components: ['ds:DsButton'], layer: 'ds' })
    expect(p.layer).toBe('ds')
    expect(p.layers).toEqual({ ds: GRANULAR_DEFAULT_LAYER_ORDER })
  })

  it('layer: null — слоя нет вовсе', () => {
    const p = presetGranular({ providers: [provider], components: ['ds:DsButton'], layer: null })
    expect(p.layer).toBeUndefined()
    expect(p.layers).toBeUndefined()
    expect(p.preflights?.[0].layer).toBeUndefined()
  })

  it('safelist union с транзитивными deps', () => {
    const p = presetGranular({
      providers: [provider],
      components: ['ds:DsFormField'],
    })
    expect((p.safelist as string[]).sort()).toEqual([
      'ds-button',
      'ds-button--primary',
      'ds-form-field',
    ])
  })

  it('провайдерские rules/preflights включены, layer применён', () => {
    const p = presetGranular({
      providers: [provider],
      components: ['ds:DsButton'],
      layer: 'granular',
      // Тест про вклад ПРОВАЙДЕРА, поэтому базовые доп-правила отключаем:
      // иначе точные счётчики ниже считали бы ещё и их.
      includeExtraRules: false,
    })
    expect(p.rules?.length).toBe(1)
    expect(p.preflights?.length).toBe(1)
    expect(p.preflights?.[0].layer).toBe('granular')
  })

  it('rules транзитивного донора подключаются, даже если его компонент не выбран', () => {
    const donor = defineGranularProvider({
      id: 'donor',
      contractVersion: 1,
      packageBaseUrl: 'file:///donor/',
      components: [{ name: 'DonorOnly', safelist: ['donor-only'] }],
      unocss: { rules: [[/^donor-grad$/, () => ({ color: 'red' })]] },
    })
    const main = defineGranularProvider({
      id: 'main',
      contractVersion: 1,
      packageBaseUrl: 'file:///main/',
      dependencies: [donor],
      components: [{ name: 'M', safelist: ['m'] }],
    })

    const p = presetGranular({ providers: [main], components: ['main:M'], includeExtraRules: false })
    expect(p.rules?.length).toBe(1)
  })

  it('unocss провайдера подключается и при пустой селекции компонентов', () => {
    const p = presetGranular({ providers: [provider], components: [], includeExtraRules: false })
    expect(p.rules?.length).toBe(1)
    expect(p.preflights?.length).toBe(1)
  })

  it('includeProviderUnocss=false отключает rules/preflights', () => {
    const p = presetGranular({
      providers: [provider],
      components: ['ds:DsButton'],
      includeProviderUnocss: false,
      includeExtraRules: false,
    })
    expect(p.rules?.length).toBe(0)
    expect(p.preflights?.length).toBe(0)
  })

  /**
   * Пресет добирает утилиты, которых нет в `presetMini`.
   *
   * Дефект, ради которого это появилось: `presetMini` не знает `animate-*`,
   * `space-*`, `divide-*` и `backdrop-*`, а компоненты провайдеров их
   * используют. Приложение, собранное по документации (`presetMini` + этот
   * пресет), получало разметку с классом и НИ СТРОЧКИ CSS к нему: спиннеры не
   * крутились, разделители списков не рисовались. Сборка при этом проходила
   * успешно — поймать можно было только глазами.
   */
  describe('базовые доп-правила', () => {
    async function generate(token: string, options?: { includeExtraRules?: boolean }) {
      const uno = await createGenerator({
        presets: [presetMini(), presetGranular({ providers: [provider], components: [], ...options })],
      })
      const { css } = await uno.generate(token, { preflights: false })
      return css.replace(/\/\*[\s\S]*?\*\//g, '').trim()
    }

    it.each([
      'animate-spin',
      'divide-y',
      'divide-[var(--gr-brd)]',
      'space-y-1',
      'backdrop-blur-sm',
      'uppercase',
      'sr-only',
      'object-cover',
      'tabular-nums',
    ])('%s генерирует CSS из коробки', async (token) => {
      expect(await generate(token)).not.toBe('')
    })

    it('`animate-spin` получает свои @keyframes', async () => {
      const uno = await createGenerator({
        presets: [presetMini(), presetGranular({ providers: [provider], components: [] })],
      })
      const { css } = await uno.generate('animate-spin')

      expect(css).toContain('@keyframes granularity-spin')
    })

    it('`tabular-nums` получает свои пустые значения по умолчанию', async () => {
      // Семейство `font-variant-numeric` собирает свойство из пяти переменных,
      // и без preflight оно схлопывается в неопределённые var() — CSS есть,
      // цифры по-прежнему пляшут. Проводка preflight'а в пресете держится
      // только этим тестом: `includeExtraRules` могла бы протащить правила
      // и потерять preflight, и снаружи это видно только глазами.
      const uno = await createGenerator({
        presets: [presetMini(), presetGranular({ providers: [provider], components: [] })],
      })
      const { css } = await uno.generate('tabular-nums')

      expect(css).toContain('--un-numeric-spacing: ')
      expect(css).toContain('--un-numeric-spacing:tabular-nums')
    })

    it('includeExtraRules=false убирает и правила, и их preflight', async () => {
      const uno = await createGenerator({
        presets: [
          presetMini(),
          presetGranular({ providers: [provider], components: [], includeExtraRules: false }),
        ],
      })
      const { css } = await uno.generate('tabular-nums animate-spin')

      expect(css).not.toContain('--un-numeric-spacing')
      expect(css).not.toContain('@keyframes granularity-spin')
    })

    it.each([
      ['uppercase', 'text-transform:uppercase'],
      ['lowercase', 'text-transform:lowercase'],
      ['capitalize', 'text-transform:capitalize'],
      ['normal-case', 'text-transform:none'],
    ])('%s задаёт text-transform', async (token, declaration) => {
      // Семейство `text-transform` живёт в presetWind*, а не в presetMini,
      // поэтому `uppercase` молча не давал CSS: класс в разметке есть,
      // текст не преобразован.
      expect(await generate(token)).toContain(declaration)
    })

    it('`sr-only` прячет элемент, оставляя его скринридеру', async () => {
      // Семейство живёт в presetWind*, а не в presetMini: без правила
      // «скрытая» подпись остаётся видимой в вёрстке, и ошибки при этом нет.
      const css = await generate('sr-only')

      expect(css).toContain('position:absolute')
      expect(css).toContain('width:1px')
      expect(css).toContain('height:1px')
      expect(css).toContain('clip:rect(0,0,0,0)')
      expect(css).toContain('white-space:nowrap')
    })

    it('`focus:not-sr-only` возвращает элемент в поток', async () => {
      // Стандартный приём «ссылка на содержимое, видимая только с клавиатуры».
      const css = await generate('focus:not-sr-only')

      expect(css).toContain(':focus')
      expect(css).toContain('position:static')
      expect(css).toContain('clip:auto')
    })

    it('`divide-<цвет>` красит именно разделители, а не контейнер', async () => {
      const css = await generate('divide-[var(--gr-brd)]')

      expect(css).toContain('border-color:var(--gr-brd)')
      // Без sibling-селектора правило покрасило бы рамку самого контейнера.
      expect(css).toContain('>:not([hidden])~:not([hidden])')
    })

    it('цветовое правило не перехватывает осевые формы `divide-*`', async () => {
      // Жадное `divide-(.+)` объявлено последним, а UnoCSS отдаёт совпадение
      // последнему подходящему правилу — без negative lookahead ширина
      // превратилась бы в цвет.
      expect(await generate('divide-y-2')).toContain('border-top-width')
      expect(await generate('divide-x')).toContain('border-left-width')
      expect(await generate('divide-y-reverse')).toContain('--un-divide-y-reverse:1')
    })

    it('includeExtraRules=false возвращает поведение presetMini', async () => {
      expect(await generate('animate-spin', { includeExtraRules: false })).toBe('')
    })

    it('правило провайдера перекрывает одноимённое базовое', async () => {
      const overriding = defineGranularProvider({
        id: 'ovr',
        contractVersion: 1,
        packageBaseUrl: 'file:///ovr/',
        components: [{ name: 'O', safelist: ['o'] }],
        unocss: { rules: [[/^animate-spin$/, () => ({ animation: 'none' })]] },
      })

      const uno = await createGenerator({
        presets: [presetMini(), presetGranular({ providers: [overriding], components: [] })],
      })
      const { css } = await uno.generate('animate-spin', { preflights: false })

      expect(css).toContain('animation:none')
    })
  })
})
