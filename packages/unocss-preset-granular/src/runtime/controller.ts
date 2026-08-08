import type { GranularThemeEntry, GranularThemeManifest } from './manifest'

/**
 * Минимум от DOM-элемента, который нужен контроллеру. Структурный тип, а не
 * `HTMLElement`: пакет не зависит от `lib.dom`, а тесты подставляют заглушку.
 */
export interface GranularThemeTarget {
  classList: {
    add: (token: string) => void
    remove: (token: string) => void
    contains: (token: string) => boolean
  }
  getAttribute: (name: string) => string | null
  setAttribute: (name: string, value: string) => void
  removeAttribute: (name: string) => void
}

/** Минимум от `localStorage`. */
export interface GranularThemeStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

export interface GranularThemeControllerOptions {
  /** Куда применять тему. По умолчанию `document.documentElement`. */
  target?: GranularThemeTarget
  /**
   * Где запоминать выбор пользователя. По умолчанию `localStorage`, если он
   * доступен. `null` — не запоминать.
   */
  storage?: GranularThemeStorage | null
  /** Ключ хранилища. По умолчанию `granular-theme`. */
  storageKey?: string
  /**
   * Что включить на старте:
   *   - имя темы — она;
   *   - `'auto'` (по умолчанию) — сохранённый выбор, иначе системная
   *     предпочтительная схема, иначе `manifest.defaultTheme`.
   */
  initial?: string | 'auto'
  /**
   * Сопоставление системной цветовой схемы именам тем — для `initial: 'auto'`.
   * По умолчанию берутся темы с именами `light`/`dark`, а если таких нет —
   * первые темы, объявившие `colorScheme` в `themes.define`.
   */
  systemThemes?: { light?: string, dark?: string }
  /**
   * Как узнать системную схему. По умолчанию
   * `matchMedia('(prefers-color-scheme: dark)')`. Вызывается один раз при
   * создании контроллера — контроллер НЕ подписывается на изменения схемы:
   * это решение приложения, и оно всегда может вызвать `set()` само.
   */
  prefersDark?: () => boolean
}

export interface GranularThemeController {
  /** Имена тем в порядке манифеста. */
  list: () => readonly string[]
  /** Текущая тема. */
  get: () => string
  /** Переключить тему: DOM + сохранение + уведомление подписчиков. */
  set: (name: string) => void
  /** Следующая тема по кругу — удобно для одной кнопки. */
  cycle: () => string
  /** Подписка на смену темы. Возвращает функцию отписки. */
  subscribe: (listener: (name: string) => void) => () => void
  /** Полная запись темы из манифеста — например, чтобы отрисовать список. */
  entry: (name: string) => GranularThemeEntry
}

const DEFAULT_STORAGE_KEY = 'granular-theme'

function defaultTarget(): GranularThemeTarget | undefined {
  const doc = (globalThis as { document?: { documentElement?: GranularThemeTarget } }).document
  return doc?.documentElement
}

function defaultStorage(): GranularThemeStorage | null {
  try {
    return (globalThis as { localStorage?: GranularThemeStorage }).localStorage ?? null
  }
  catch {
    // Доступ к localStorage может бросать (Safari в приватном режиме, iframe
    // с чужим origin) — это не повод падать при старте приложения.
    return null
  }
}

function defaultPrefersDark(): boolean {
  const mm = (globalThis as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia
  return mm ? mm('(prefers-color-scheme: dark)').matches : false
}

/**
 * Контроллер переключения тем поверх манифеста, собранного сборкой.
 *
 * Токены всех тем уже в CSS — контроллер лишь приводит DOM в состояние, при
 * котором совпадает нужный блок. Никакой генерации стилей в рантайме, никакого
 * FOUC-friendly магии: применение синхронно и стоит одну операцию над
 * элементом.
 *
 * ```ts
 * import manifest from 'virtual:granular-themes'
 * import { createThemeController } from '@feugene/unocss-preset-granular/runtime'
 *
 * const themes = createThemeController(manifest)
 * themes.list()      // ['light', 'dark']
 * themes.set('dark') // <html data-theme="dark">
 * ```
 */
export function createThemeController(
  manifest: GranularThemeManifest,
  options: GranularThemeControllerOptions = {},
): GranularThemeController {
  if (!manifest || manifest.themes.length === 0)
    throw new Error('createThemeController: the manifest is empty — the build contains no themes.')

  const byName = new Map(manifest.themes.map(theme => [theme.name, theme]))
  const target = options.target ?? defaultTarget()
  const storage = options.storage === undefined ? defaultStorage() : options.storage
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY
  const listeners = new Set<(name: string) => void>()

  const entry = (name: string): GranularThemeEntry => {
    const found = byName.get(name)
    if (!found) {
      throw new Error(
        `createThemeController: theme '${name}' is not in the build. `
        + `Available: ${manifest.themes.map(t => t.name).join(', ')}. `
        + `The theme set is controlled by the preset's 'themes.names' option (or the providers' 'defaultThemes').`,
      )
    }
    return found
  }

  /** Снимает активацию темы — но только если она была проставлена ею. */
  const deactivate = (theme: GranularThemeEntry): void => {
    if (!target)
      return
    const { activation } = theme
    if (activation.type === 'class')
      target.classList.remove(activation.value)
    else if (activation.type === 'attribute' && target.getAttribute(activation.name) === activation.value)
      target.removeAttribute(activation.name)
  }

  const activate = (theme: GranularThemeEntry): void => {
    if (!target)
      return
    const { activation } = theme
    if (activation.type === 'class')
      target.classList.add(activation.value)
    else if (activation.type === 'attribute')
      target.setAttribute(activation.name, activation.value)
    // 'root' — активна по факту отсутствия других; делать нечего.
  }

  const apply = (name: string): void => {
    const theme = entry(name)

    if (theme.activation.type === 'unknown') {
      throw new Error(
        `createThemeController: the build could not derive an activation selector for theme '${name}' `
        + `(selectors: ${theme.selectors.length ? theme.selectors.join(', ') : '—'}). `
        + `This happens when a provider ships the theme as a ready-made CSS file: the preset inlines it `
        + `as-is and does not know what is inside. Either switch the provider to 'tokenDefinitions', `
        + `or set the activation explicitly via the 'activations' option when building the manifest.`,
      )
    }

    // Сначала снимаем чужие активации: иначе класс предыдущей темы останется
    // висеть и продолжит перебивать новую по каскаду.
    for (const other of manifest.themes) {
      if (other.name !== name)
        deactivate(other)
    }
    activate(theme)
  }

  const pickInitial = (): string => {
    const requested = options.initial ?? 'auto'
    if (requested !== 'auto')
      return requested

    const stored = storage?.getItem(storageKey)
    if (stored && byName.has(stored))
      return stored

    const system = options.systemThemes ?? {}
    // Порядок источников: явная опция → тема с таким именем → первая тема,
    // объявившая `colorScheme` в манифесте. Последнее и делает `auto`
    // работоспособным в приложении, где тем `light`/`dark` нет вовсе, а есть
    // `emerald`/`ocean`: имя темы больше ничего не обязано означать.
    const byScheme = (scheme: 'light' | 'dark'): string | undefined =>
      manifest.themes.find(theme => theme.colorScheme === scheme)?.name
    const dark = system.dark ?? (byName.has('dark') ? 'dark' : byScheme('dark'))
    const light = system.light ?? (byName.has('light') ? 'light' : byScheme('light'))
    const prefersDark = options.prefersDark ?? defaultPrefersDark
    const bySystem = prefersDark() ? dark : light
    if (bySystem && byName.has(bySystem))
      return bySystem

    return manifest.defaultTheme
  }

  let current = pickInitial()
  apply(current)

  return {
    list: () => manifest.themes.map(theme => theme.name),
    get: () => current,
    entry,

    set(name) {
      apply(name)
      current = name
      storage?.setItem(storageKey, name)
      for (const listener of listeners)
        listener(name)
    },

    cycle() {
      const names = manifest.themes.map(theme => theme.name)
      const next = names[(names.indexOf(current) + 1) % names.length]
      this.set(next)
      return next
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
}
