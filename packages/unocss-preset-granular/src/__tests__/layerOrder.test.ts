import type { GranularProvider } from '../contract'

import { createGenerator, presetMini } from 'unocss'
import { describe, expect, it } from 'vitest'

import { defineGranularProvider } from '../contract'
import { presetGranular } from '../preset'

function makeProvider(): GranularProvider {
  return defineGranularProvider({
    id: 'ds',
    contractVersion: 1,
    packageBaseUrl: 'file:///ds/',
    components: [{ name: 'Btn', safelist: ['ds-btn'] }],
    unocss: {
      rules: [[/^ds-btn$/, () => ({ padding: '4px' })]],
      preflights: [{ getCSS: () => '.ds-base{margin:0}' }],
    },
  })
}

async function layersOf(layer?: string | null, userLayers?: Record<string, number>): Promise<string[]> {
  const preset = presetGranular({
    providers: [makeProvider()],
    components: ['ds:Btn'],
    ...(layer === undefined ? {} : { layer }),
  })
  const uno = await createGenerator({
    presets: [presetMini(), preset],
    ...(userLayers ? { layers: userLayers } : {}),
  })
  const { css } = await uno.generate('p-5')
  return [...css.matchAll(/\/\* layer: ([\w-]+) \*\//g)].map(m => m[1])
}

describe('порядок слоёв в итоговом CSS', () => {
  it('по умолчанию granular идёт ДО утилит', async () => {
    // Ключевое свойство: утилита (`p-5`) должна перебивать базовый стиль
    // компонента, а не наоборот. Без объявленного порядка слой получил бы
    // `?? 0` — как `default` — и уехал бы ПОСЛЕ утилит по алфавиту.
    expect(await layersOf()).toEqual(['preflights', 'granular', 'default'])
  })

  it('кастомное имя слоя получает тот же порядок', async () => {
    expect(await layersOf('ds')).toEqual(['preflights', 'ds', 'default'])
  })

  it('layer: null — всё уходит в штатные слои UnoCSS', async () => {
    // preflight'ы → `preflights`, правила провайдера → `default`.
    expect(await layersOf(null)).toEqual(['preflights', 'default'])
  })

  it('приложение может переопределить порядок своим layers', async () => {
    expect(await layersOf(undefined, { granular: 50 })).toEqual(['preflights', 'default', 'granular'])
  })
})

describe('изоляция правил провайдера между конфигами', () => {
  it('слой первого генератора не прилипает к правилам провайдера', async () => {
    // UnoCSS штампует `meta.layer`/`meta.__index` в кортежи правил МУТАЦИЕЙ
    // на месте, поэтому пресет отдаёт копии, а не объекты провайдера.
    // Без копии второй конфиг не смог бы переопределить слой: проверка в
    // `resolvePreset` — `meta.layer == null`.
    const shared = makeProvider()
    const opts = { providers: [shared], components: ['ds:Btn'] } as const

    const first = await createGenerator({
      presets: [presetMini(), presetGranular({ ...opts, layer: 'granular' })],
    })
    await first.generate('p-5')

    const second = await createGenerator({
      presets: [presetMini(), presetGranular({ ...opts, layer: null })],
    })
    const { css } = await second.generate('p-5')

    expect([...css.matchAll(/\/\* layer: ([\w-]+) \*\//g)].map(m => m[1]))
      .toEqual(['preflights', 'default'])
    // И сам объект провайдера остался нетронутым.
    expect(shared.unocss?.rules?.[0][2]).toBeUndefined()
  })
})
