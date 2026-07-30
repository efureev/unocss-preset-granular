import type {
  GranularComponentDescriptor,
  GranularProvider,
  GranularThemeTokenRef,
  GranularThemeTokenSet,
} from '../contract'
import type { GranularAppThemeDefinition } from '../core/resolveThemes'
import type { PresetGranularOptions } from '../preset'

import { existsSync } from 'node:fs'

import { APP_THEME_SOURCE } from '../core/resolveThemes'
import { isCssDataUrl, resolveCssFilePath } from '../fs/readCss'
import { tokenDefinitionsFromCssSync } from './tokenDefinitionsFromCss'

/**
 * Ошибка чтения CSS, на который ссылается `tokenDefinitionsRef`.
 *
 * Отдельный класс, а не голый `ENOENT`: в сообщении обязаны быть провайдер,
 * компонент и тема — иначе пользователь получает абсолютный путь и гадает,
 * кто из десятка компонентов его объявил.
 */
export class GranularTokenRefError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly themeName: string,
    public readonly componentName: string | undefined,
    public readonly url: string,
    public readonly cause: unknown,
  ) {
    // Приложение — такой же источник ссылок, как провайдер, но подсказка про
    // сборку пакета ему не адресована: файл лежит в самом приложении.
    const isApp = providerId === APP_THEME_SOURCE

    const field = isApp
      ? `themes.define['${themeName}'].tokensRef`
      : `tokenDefinitionsRef['${themeName}']`

    const where = isApp
      ? 'the application'
      : `${componentName ? `component '${componentName}' of provider` : 'provider'} '${providerId}'`

    const hint = isApp
      ? `  hint: относительный путь резолвится от process.cwd() — от корня приложения. `
      + `Надёжнее указывать литералом: new URL('./themes/${themeName}.css', import.meta.url).href.`
      : `  hint: если файл не эмитится сборкой провайдера, объявляйте ссылку литералом — `
        + `new URL('./themes/${themeName}.css', import.meta.url).href: именно на него реагирует бандлер `
        + `и кладёт CSS в свой выход (обычно как data:-URL). Строковая форма './themes/${themeName}.css' `
        + `рассчитана на файлы, которые и так лежат в 'components/<Name>/...' собранного пакета.`

    super(
      `Granular: failed to resolve ${field} declared by ${where}.\n`
      + `  url: ${url}\n`
      + `  cause: ${(cause as Error)?.message ?? cause}\n${
        hint}`,
    )
    this.name = 'GranularTokenRefError'
  }
}

interface RefContext {
  providerId: string
  componentName?: string
  packageBaseUrl: string
}

/**
 * Выбирает источник для парсера: сам `url`, а если его нет на диске —
 * `assetName`, резолвнутый от `packageBaseUrl`.
 *
 * Та же схема, что у `cssFiles` / `cssFileAssetNames`: в монорепо путь ведёт в
 * `src/`, в опубликованном пакете (только `dist/`) — срабатывает fallback.
 */
function pickRefSource(ref: GranularThemeTokenRef, packageBaseUrl: string): string {
  if (isCssDataUrl(ref.url))
    return ref.url

  const path = resolveCssFilePath(ref.url)
  if (existsSync(path) || !ref.assetName)
    return path

  return resolveCssFilePath(new URL(ref.assetName, packageBaseUrl).href)
}

function readTokenSet(
  themeName: string,
  ref: GranularThemeTokenRef | string,
  context: RefContext,
): GranularThemeTokenSet {
  const normalized: GranularThemeTokenRef = typeof ref === 'string' ? { url: ref } : ref

  try {
    return tokenDefinitionsFromCssSync(pickRefSource(normalized, context.packageBaseUrl), {
      ...(normalized.selector !== undefined ? { selector: normalized.selector } : {}),
      ...(normalized.as !== undefined ? { as: normalized.as } : {}),
      ...(normalized.strict !== undefined ? { strict: normalized.strict } : {}),
    })
  }
  catch (error) {
    throw new GranularTokenRefError(
      context.providerId,
      themeName,
      context.componentName,
      normalized.url,
      error,
    )
  }
}

/**
 * Разворачивает карту ссылок в карту наборов токенов.
 *
 * Литеральные `tokenDefinitions` для той же темы имеют приоритет: конкретное
 * значение специфичнее ссылки, и это даёт провайдеру способ переопределить
 * собственную ссылку, не убирая её.
 */
function materializeRefs(
  refs: Readonly<Record<string, GranularThemeTokenRef | string>> | undefined,
  literals: Readonly<Record<string, GranularThemeTokenSet>> | undefined,
  context: RefContext,
): Readonly<Record<string, GranularThemeTokenSet>> | undefined {
  if (!refs)
    return literals

  const resolved: Record<string, GranularThemeTokenSet> = {}
  for (const [themeName, ref] of Object.entries(refs))
    resolved[themeName] = readTokenSet(themeName, ref, context)

  return { ...resolved, ...literals }
}

function materializeComponent(
  descriptor: GranularComponentDescriptor,
  providerId: string,
  packageBaseUrl: string,
): GranularComponentDescriptor {
  if (!descriptor.tokenDefinitionsRef)
    return descriptor

  return {
    ...descriptor,
    tokenDefinitions: materializeRefs(
      descriptor.tokenDefinitionsRef,
      descriptor.tokenDefinitions,
      { providerId, componentName: descriptor.name, packageBaseUrl },
    ),
  }
}

function materializeProvider(
  provider: GranularProvider,
  seen: Map<GranularProvider, GranularProvider>,
): GranularProvider {
  const cached = seen.get(provider)
  if (cached)
    return cached

  // Доноры разворачиваются рекурсивно и ЧЕРЕЗ ТОТ ЖЕ `seen`: иначе diamond-граф
  // дал бы два разных инстанса одного донора, а `expandProviders` считает это
  // `DuplicateProviderIdError`.
  const dependencies = provider.dependencies?.map(dependency =>
    typeof dependency === 'string' ? dependency : materializeProvider(dependency, seen),
  )

  const components = provider.components.map(descriptor =>
    materializeComponent(descriptor, provider.id, provider.packageBaseUrl),
  )

  const themeRefs = provider.theme?.tokenDefinitionsRef
  const theme = themeRefs
    ? {
        ...provider.theme,
        tokenDefinitions: materializeRefs(
          themeRefs,
          provider.theme?.tokenDefinitions,
          { providerId: provider.id, packageBaseUrl: provider.packageBaseUrl },
        ),
      }
    : provider.theme

  const changed
    = theme !== provider.theme
      || components.some((descriptor, index) => descriptor !== provider.components[index])
      || dependencies?.some((dependency, index) => dependency !== provider.dependencies?.[index])

  // Провайдер без ссылок возвращается ПО ИДЕНТИЧНОСТИ — от неё зависят и дедуп
  // в `expandProviders`, и сообщения об ошибках, и кэши.
  const result = changed
    ? { ...provider, components, ...(theme ? { theme } : {}), ...(dependencies ? { dependencies } : {}) }
    : provider

  seen.set(provider, result)
  return result
}

/**
 * Разворачивает `themes.define[*].tokensRef` в литеральные `tokens`.
 *
 * Приложение — такой же источник токенов, как провайдер, и ему нужен тот же
 * способ держать палитру в CSS, а не в TS-литерале. Отличия два:
 * `packageBaseUrl` нет (fallback по `assetName` неприменим — файл лежит в
 * самом приложении), а `as`-селектор ссылки работает как `selector` темы,
 * если явный `selector` не задан.
 *
 * Литеральные `tokens` имеют приоритет над значениями из файла — как и у
 * провайдеров.
 */
function materializeAppThemes(
  define: Readonly<Record<string, GranularAppThemeDefinition>>,
): Record<string, GranularAppThemeDefinition> {
  const resolved: Record<string, GranularAppThemeDefinition> = {}

  for (const [themeName, definition] of Object.entries(define)) {
    if (!definition.tokensRef) {
      resolved[themeName] = definition
      continue
    }

    const ref = definition.tokensRef
    const parsed = readTokenSet(themeName, ref, {
      providerId: APP_THEME_SOURCE,
      packageBaseUrl: '',
    })

    const { tokensRef: _dropped, ...rest } = definition
    resolved[themeName] = {
      ...rest,
      tokens: { ...parsed.tokens, ...definition.tokens },
      ...(definition.selector === undefined && typeof ref === 'object' && ref.as !== undefined
        ? { selector: ref.as }
        : {}),
    }
  }

  return resolved
}

const materializedCache = new WeakMap<PresetGranularOptions, PresetGranularOptions>()

/**
 * Разворачивает все `tokenDefinitionsRef` в готовые `tokenDefinitions`,
 * возвращая ПРОИЗВОДНЫЙ объект опций.
 *
 * Почему так, а не пост-обработкой реестра тем: приоритеты слияния токенов
 * (провайдеры → компоненты → app-overrides), фильтрация по активным темам и
 * диагностика живут в `resolveThemes`. Материализация «до» оставляет всю эту
 * логику в одном месте — ниже по течению ссылок уже не существует.
 *
 * Чтение синхронное (`readFileSync`), как и весь остальной FS в node-слое
 * (`existsSync`/`statSync` при скане): конфиг Vite грузится синхронно.
 *
 * Результат мемоизирован по идентичности исходных опций и стабилен по ссылке —
 * на нём держатся все кэши ниже (резолюция, скан, `content`).
 * Если ссылок нет ни у кого, возвращается ИСХОДНЫЙ объект.
 */
export function materializeGranularOptions<T extends PresetGranularOptions>(options: T): T {
  const cached = materializedCache.get(options)
  if (cached)
    return cached as T

  const seen = new Map<GranularProvider, GranularProvider>()
  const providers = options.providers.map(provider => materializeProvider(provider, seen))

  const define = options.themes?.define
  const hasAppRefs = define !== undefined && Object.values(define).some(d => d.tokensRef !== undefined)
  const themes = hasAppRefs
    ? { ...options.themes, define: materializeAppThemes(define) }
    : options.themes

  const changed
    = providers.some((provider, index) => provider !== options.providers[index])
      || themes !== options.themes
  const result = changed ? { ...options, providers, ...(themes ? { themes } : {}) } : options

  materializedCache.set(options, result)
  return result as T
}
