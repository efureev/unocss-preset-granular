import type {
  GranularComponentDescriptor,
  GranularProvider,
  GranularThemeTokenRef,
  GranularThemeTokenSet,
} from '../contract'
import type { PresetGranularOptions } from '../preset'

import { existsSync } from 'node:fs'

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
    const where = componentName ? `component '${componentName}' of provider` : 'provider'
    super(
      `Granular: failed to resolve tokenDefinitionsRef['${themeName}'] declared by ${where} '${providerId}'.\n`
      + `  url: ${url}\n`
      + `  cause: ${(cause as Error)?.message ?? cause}\n`
      + `  hint: если файл не эмитится сборкой провайдера, объявляйте ссылку литералом — `
      + `new URL('./themes/${themeName}.css', import.meta.url).href: именно на него реагирует бандлер `
      + `и кладёт CSS в свой выход (обычно как data:-URL). Строковая форма './themes/${themeName}.css' `
      + `рассчитана на файлы, которые и так лежат в 'components/<Name>/...' собранного пакета.`,
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

  const changed = providers.some((provider, index) => provider !== options.providers[index])
  const result = changed ? { ...options, providers } : options

  materializedCache.set(options, result)
  return result as T
}
