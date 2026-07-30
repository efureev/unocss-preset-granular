import type { GranularThemeManifest, GranularThemeTarget } from '../runtime'

import { describe, expect, it, vi } from 'vitest'

import { defineGranularProvider } from '../contract'
import { getGranularThemeManifest, GRANULAR_THEMES_MODULE_ID, granularThemesPlugin } from '../node-utils/themeManifest'
import { createThemeController, resolveThemeActivation } from '../runtime'

/** Заглушка `document.documentElement` — контроллер типизирован структурно. */
function createTarget(): GranularThemeTarget & { classes: Set<string>, attributes: Map<string, string> } {
  const classes = new Set<string>()
  const attributes = new Map<string, string>()
  return {
    classes,
    attributes,
    classList: {
      add: t => void classes.add(t),
      remove: t => void classes.delete(t),
      contains: t => classes.has(t),
    },
    getAttribute: name => attributes.get(name) ?? null,
    setAttribute: (name, value) => void attributes.set(name, value),
    removeAttribute: name => void attributes.delete(name),
  }
}

function manifestOf(themes: GranularThemeManifest['themes']): GranularThemeManifest {
  return { themes, defaultTheme: themes[0].name }
}

describe('resolveThemeActivation', () => {
  it(':root — тема активна всегда', () => {
    expect(resolveThemeActivation([':root'])).toEqual({ type: 'root' })
    expect(resolveThemeActivation(['html'])).toEqual({ type: 'root' })
  })

  it('одиночный класс', () => {
    expect(resolveThemeActivation(['.dark'])).toEqual({ type: 'class', value: 'dark' })
  })

  it('атрибут — в кавычках, апострофах и без', () => {
    expect(resolveThemeActivation(['[data-theme="dark"]'])).toEqual({ type: 'attribute', name: 'data-theme', value: 'dark' })
    expect(resolveThemeActivation(['[data-theme=\'hc\']'])).toEqual({ type: 'attribute', name: 'data-theme', value: 'hc' })
    expect(resolveThemeActivation(['[data-theme=sepia]'])).toEqual({ type: 'attribute', name: 'data-theme', value: 'sepia' })
  })

  it('из списка альтернатив атрибут выигрывает у класса', () => {
    // Он взаимоисключающий по природе: при трёх темах не нужно вычищать
    // классы предыдущей.
    expect(resolveThemeActivation(['.theme-dark, .dark, [data-theme="dark"]']))
      .toEqual({ type: 'attribute', name: 'data-theme', value: 'dark' })
  })

  it('класс выигрывает у :root, если оба есть', () => {
    expect(resolveThemeActivation([':root', '.dark'])).toEqual({ type: 'class', value: 'dark' })
  })

  it('невыводимые селекторы дают unknown', () => {
    expect(resolveThemeActivation([])).toEqual({ type: 'unknown' })
    expect(resolveThemeActivation(['.a .b'])).toEqual({ type: 'unknown' })
    expect(resolveThemeActivation(['[data-theme]'])).toEqual({ type: 'unknown' })
    expect(resolveThemeActivation(['@media (min-width: 100px)'])).toEqual({ type: 'unknown' })
  })
})

describe('манифест собирается из той же резолюции, что и CSS', () => {
  const provider = defineGranularProvider({
    id: 'ds',
    contractVersion: 1,
    packageBaseUrl: 'file:///ds/',
    components: [],
    theme: {
      defaultThemes: ['light', 'dark'],
      tokenDefinitions: {
        light: { selector: ':root', tokens: { brd: '#eee' } },
        dark: { selector: '.dark, [data-theme="dark"]', tokens: { brd: '#333' } },
      },
    },
  })

  it('имена, селекторы и активации берутся из resolveThemes', () => {
    const manifest = getGranularThemeManifest({ providers: [provider] })

    expect(manifest.defaultTheme).toBe('light')
    expect(manifest.themes.map(t => t.name)).toEqual(['light', 'dark'])
    expect(manifest.themes[0].activation).toEqual({ type: 'root' })
    expect(manifest.themes[1].selectors).toEqual(['.dark, [data-theme="dark"]'])
    expect(manifest.themes[1].activation).toEqual({ type: 'attribute', name: 'data-theme', value: 'dark' })
  })

  it('значения токенов не попадают в манифест без includeTokens', () => {
    expect(getGranularThemeManifest({ providers: [provider] }).themes[0].tokens).toBeUndefined()
    expect(getGranularThemeManifest({ providers: [provider] }, { includeTokens: true }).themes[0].tokens)
      .toEqual({ ':root': { brd: '#eee' } })
  })

  it('тема из CSS-файла даёт unknown, но чинится явной активацией', () => {
    const fileThemed = defineGranularProvider({
      id: 'file',
      contractVersion: 1,
      packageBaseUrl: 'file:///file/',
      components: [],
      theme: { defaultThemes: ['dark'], themes: { dark: 'file:///file/dark.css' } },
    })

    expect(getGranularThemeManifest({ providers: [fileThemed] }).themes[0].activation)
      .toEqual({ type: 'unknown' })

    const fixed = getGranularThemeManifest(
      { providers: [fileThemed] },
      { activations: { dark: { type: 'class', value: 'dark' } } },
    )
    expect(fixed.themes[0].activation).toEqual({ type: 'class', value: 'dark' })
  })

  it('плагин отдаёт манифест виртуальным модулем', () => {
    const plugin = granularThemesPlugin({ providers: [provider] })
    const resolved = plugin.resolveId(GRANULAR_THEMES_MODULE_ID)

    expect(resolved).toBeDefined()
    expect(plugin.resolveId('другое')).toBeUndefined()

    const code = plugin.load(resolved!)!
    expect(code).toContain('export default')
    expect(JSON.parse(code.replace('export default ', ''))).toEqual(
      getGranularThemeManifest({ providers: [provider] }),
    )
  })
})

describe('createThemeController', () => {
  const manifest = manifestOf([
    { name: 'light', selectors: [':root'], activation: { type: 'root' } },
    { name: 'dark', selectors: ['.dark'], activation: { type: 'class', value: 'dark' } },
    { name: 'hc', selectors: ['[data-theme="hc"]'], activation: { type: 'attribute', name: 'data-theme', value: 'hc' } },
  ])

  const setup = (options = {}) => {
    const target = createTarget()
    const controller = createThemeController(manifest, { target, storage: null, ...options })
    return { target, controller }
  }

  it('на старте активна тема по умолчанию', () => {
    const { target, controller } = setup()
    expect(controller.get()).toBe('light')
    expect(controller.list()).toEqual(['light', 'dark', 'hc'])
    expect(target.classes.size).toBe(0)
    expect(target.attributes.size).toBe(0)
  })

  it('переключение проставляет класс/атрибут и снимает предыдущий', () => {
    const { target, controller } = setup()

    controller.set('dark')
    expect(target.classes.has('dark')).toBe(true)

    controller.set('hc')
    // Класс предыдущей темы обязан уйти — иначе он продолжит перебивать
    // новую по каскаду.
    expect(target.classes.has('dark')).toBe(false)
    expect(target.attributes.get('data-theme')).toBe('hc')

    controller.set('light')
    expect(target.classes.size).toBe(0)
    expect(target.attributes.has('data-theme')).toBe(false)
  })

  it('не трогает чужой атрибут с тем же именем', () => {
    const { target, controller } = setup()
    target.attributes.set('data-theme', 'что-то-своё')

    controller.set('dark')
    expect(target.attributes.get('data-theme')).toBe('что-то-своё')
  })

  it('cycle идёт по кругу', () => {
    const { controller } = setup()
    expect(controller.cycle()).toBe('dark')
    expect(controller.cycle()).toBe('hc')
    expect(controller.cycle()).toBe('light')
  })

  it('подписчики получают новое имя, отписка работает', () => {
    const { controller } = setup()
    const seen: string[] = []
    const off = controller.subscribe(name => seen.push(name))

    controller.set('dark')
    off()
    controller.set('hc')

    expect(seen).toEqual(['dark'])
  })

  it('неизвестная тема — ошибка со списком доступных', () => {
    const { controller } = setup()
    expect(() => controller.set('nope')).toThrow(/light, dark, hc/)
  })

  it('тема без выводимой активации — ошибка с объяснением, что делать', () => {
    const broken = manifestOf([
      { name: 'light', selectors: [':root'], activation: { type: 'root' } },
      { name: 'dark', selectors: [], activation: { type: 'unknown' } },
    ])
    const controller = createThemeController(broken, { target: createTarget(), storage: null })
    expect(() => controller.set('dark')).toThrow(/tokenDefinitions|activations/)
  })

  it('запоминает выбор и восстанавливает его при следующем создании', () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    }

    const first = createThemeController(manifest, { target: createTarget(), storage })
    first.set('hc')

    const target = createTarget()
    const second = createThemeController(manifest, { target, storage })
    expect(second.get()).toBe('hc')
    expect(target.attributes.get('data-theme')).toBe('hc')
  })

  it('без сохранённого выбора ориентируется на системную схему', () => {
    const { controller } = setup({ prefersDark: () => true })
    expect(controller.get()).toBe('dark')

    const { controller: light } = setup({ prefersDark: () => false })
    expect(light.get()).toBe('light')
  })

  it('явный initial перебивает и хранилище, и систему', () => {
    const storage = { getItem: () => 'dark', setItem: vi.fn() }
    const { controller } = setup({ storage, prefersDark: () => true, initial: 'hc' })
    expect(controller.get()).toBe('hc')
  })

  it('пустой манифест — внятная ошибка, а не тихое ничего', () => {
    expect(() => createThemeController({ themes: [], defaultTheme: '' }))
      .toThrow(/манифест пуст/)
  })
})
