import { describe, expect, it } from 'vitest'

import { granularAssetFileNames, granularChunkFileNames } from '../vite'

describe('granularChunkFileNames', () => {
  const chunk = granularChunkFileNames()

  it('sFC компонента уезжает в его собственную директорию', () => {
    expect(chunk({ moduleIds: ['/abs/pkg/src/components/XTest1/XTest1.vue'] }))
      .toBe('components/XTest1/chunks/[name]-[hash].js')
  })

  it('shared-SFC группы имеет ПРИОРИТЕТ над правилом компонента', () => {
    // Тот же id матчится обоими регексами: componentRegex захватил бы
    // `groupA` как имя компонента и увёл чанк в несуществующую директорию.
    const id = '/abs/pkg/src/components/groupA/shared/Shared.vue'
    expect(chunk({ moduleIds: [id] })).toBe('groups/groupA/shared/[name]-[hash].js')
  })

  it('не-компонентные чанки остаются плоскими', () => {
    expect(chunk({ moduleIds: ['/abs/pkg/src/granular-provider/index.ts'] }))
      .toBe('chunks/[name]-[hash].js')
    expect(chunk({})).toBe('chunks/[name]-[hash].js')
  })

  it('паттерны и регексы переопределяются', () => {
    const custom = granularChunkFileNames({
      componentModuleRegex: /\/ui\/([^/]+)\/[^/]+\.vue$/,
      componentChunkPattern: 'c/<name>/[name].js',
    })
    expect(custom({ moduleIds: ['/abs/pkg/ui/Btn/Btn.vue'] })).toBe('c/Btn/[name].js')
  })
})

describe('granularAssetFileNames', () => {
  it('cSS компонента уезжает в components/<Name>/styles.css', () => {
    const assets = granularAssetFileNames({ components: ['XTest1', 'XTokenized'] })
    expect(assets({ name: 'XTest1.css' })).toBe('components/XTest1/styles.css')
    expect(assets({ name: 'XTokenized.css' })).toBe('components/XTokenized/styles.css')
  })

  it('чужие ассеты не трогаются', () => {
    const assets = granularAssetFileNames({ components: ['XTest1'] })
    expect(assets({ name: 'index.css' })).toBe('[name][extname]')
    expect(assets({ name: 'logo.svg' })).toBe('[name][extname]')
    expect(assets({})).toBe('[name][extname]')
  })

  it('без списка компонентов работает эвристика «имя с заглавной»', () => {
    const assets = granularAssetFileNames()
    expect(assets({ name: 'XTest1.css' })).toBe('components/XTest1/styles.css')
    // Пакетный entry не должен уехать в components/index/
    expect(assets({ name: 'index.css' })).toBe('[name][extname]')
  })

  it('совпадает с тем, что кладёт defineGranularComponent в styleAssetFileName', async () => {
    const { defineGranularComponent } = await import('../contract')
    const descriptor = defineGranularComponent('file:///pkg/src/components/XTest1/config.ts', {
      name: 'XTest1',
    })
    const assets = granularAssetFileNames({ components: ['XTest1'] })
    expect(assets({ name: 'XTest1.css' })).toBe(descriptor.styleAssetFileName)
  })

  it('паттерны переопределяются', () => {
    const assets = granularAssetFileNames({
      components: ['Btn'],
      styleAssetPattern: 'c/<name>/style.css',
      fallbackAssetPattern: 'assets/[name][extname]',
    })
    expect(assets({ name: 'Btn.css' })).toBe('c/Btn/style.css')
    expect(assets({ name: 'other.css' })).toBe('assets/[name][extname]')
  })
})
