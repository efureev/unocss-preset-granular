import type {
  GranularComponentDescriptor,
  GranularProvider,
  GranularThemeTokenRef,
  GranularThemeTokenSet,
} from '../contract'

/**
 * Последний рубеж: если `names` не передан, ни один провайдер не объявил
 * `theme.defaultThemes` и приложение не объявило `themes.define` — грузим
 * только `light`.
 */
export const GRANULAR_DEFAULT_THEME_NAMES = ['light'] as const

/**
 * Селектор по умолчанию для темы, объявленной ПРИЛОЖЕНИЕМ.
 *
 * Атрибут, а не класс: `data-theme` держит ровно одно значение, поэтому
 * переключение между тремя и более темами не требует вычищать классы
 * предыдущей. Тот же вывод делает `resolveThemeActivation` в манифесте —
 * активация такой темы всегда однозначна.
 *
 * Приложению с ЕДИНСТВЕННОЙ темой обычно нужен `selector: ':root'` — тогда
 * тема активна по факту существования и рантайм-переключатель не нужен вовсе.
 */
export function defaultAppThemeSelector(name: string): string {
  return `[data-theme="${name}"]`
}

/**
 * Определение темы на стороне ПРИЛОЖЕНИЯ.
 *
 * Закрывает случай, ради которого пресет и делает темы произвольными строками:
 * набор тем принадлежит приложению, а не провайдерам. Приложение вправе
 * объявить свои `emerald`/`ocean`/`crimson` и не подключать ни `light`, ни
 * `dark`, даже если провайдеры их поставляют.
 *
 * Определение НЕ заменяет вклад провайдеров в тему с тем же именем, а ложится
 * ПОВЕРХ него (приоритет: провайдеры → компоненты → `define` → `tokenOverrides`).
 * Определение без `tokens`/`extends` — это чистые метаданные (`label`,
 * `colorScheme`) для темы, которую и так поставляет провайдер.
 */
export interface GranularAppThemeDefinition {
  /**
   * Имя темы, ЭФФЕКТИВНЫЕ токены которой взять за основу.
   *
   * База резолвится полностью (провайдеры + компоненты + её собственное
   * `define`), её токены становятся САМЫМ НИЖНИМ слоем этой темы, а все они
   * переезжают под селектор этой темы. Базу НЕ обязательно включать в
   * `names`: `names: ['emerald'], define: { emerald: { extends: 'light' } }`
   * даёт сборку, в которой темы `light` нет, но её значения унаследованы.
   *
   * Наследовать можно только тему со СТРУКТУРНЫМИ токенами
   * (`tokenDefinitions`/`tokenDefinitionsRef`). Тема, которую провайдер отдаёт
   * готовым CSS-файлом (`theme.themes[name]`), для пресета непрозрачна —
   * будет предупреждение `theme-extends-unresolved`.
   */
  extends?: string
  /**
   * Селектор, под которым эмитить токены темы.
   * По умолчанию — селектор, уже выбранный провайдерами для этой темы, а если
   * тема целиком приложенческая — {@link defaultAppThemeSelector}.
   *
   * Указание `selector` (как и `extends`) СХЛОПЫВАЕТ тему в один блок: все
   * токены, откуда бы они ни пришли, эмитятся под этим селектором.
   */
  selector?: string
  /** Собственные токены темы, БЕЗ префикса `--`. */
  tokens?: Readonly<Record<string, string>>
  /**
   * То же, что {@link tokens}, но значения вычитываются node-слоем из CSS —
   * как `tokenDefinitionsRef` у провайдера. Литеральные `tokens` имеют
   * приоритет над значениями из файла.
   */
  tokensRef?: GranularThemeTokenRef | string
  /** Человекочитаемое имя для переключателя тем. Уезжает в манифест. */
  label?: string
  /**
   * К какой системной схеме тяготеет тема. Используется рантаймом при
   * `initial: 'auto'`, когда тем `light`/`dark` в сборке нет вовсе.
   */
  colorScheme?: 'light' | 'dark'
}

/** Метаданные темы, которые ядро прокидывает в манифест. */
export interface GranularThemeMeta {
  label?: string
  colorScheme?: 'light' | 'dark'
}

export interface ResolveThemesInput {
  /**
   * Явный список тем.
   *
   *   - `undefined` — имена берутся из ключей {@link define}, если оно задано;
   *     иначе из `theme.defaultThemes` провайдеров (объединение в порядке
   *     провайдеров, дедуп), а если их никто не объявил — из
   *     {@link GRANULAR_DEFAULT_THEME_NAMES};
   *   - `[]` — тем нет вообще (это НЕ то же самое, что `undefined`).
   */
  names?: readonly string[]
  /**
   * Темы, объявленные самим приложением. См. {@link GranularAppThemeDefinition}.
   *
   * ВАЖНО: как только `define` задано, а `names` — нет, набор тем сборки равен
   * КЛЮЧАМ `define`. Приложение, объявившее свои темы, владеет списком целиком;
   * `defaultThemes` провайдеров в этом случае не смотрятся. Нужны и те и те —
   * перечислите всё в `names` явно.
   */
  define?: Readonly<Record<string, GranularAppThemeDefinition>>
}

/** Откуда взялся итоговый `names`. */
export type ThemeNamesSource
  /** `input.names` задан приложением явно. */
  = | 'explicit'
  /** Ключи `themes.define` — приложение объявило свои темы. */
    | 'app-defined'
  /** Объединение `theme.defaultThemes` провайдеров. */
    | 'provider-defaults'
  /** Никто ничего не объявил — жёсткий фолбэк `['light']`. */
    | 'fallback'

/**
 * Диагностика резолва тем. Ошибок не бросает: набор тем — это конфигурация,
 * а не нарушение контракта. Потребитель — `granular doctor`.
 */
export type ResolvedThemeWarning
  /**
   * Провайдер объявил тему в `defaultThemes`, но сам её не поставляет
   * (нет ни `themes[name]`, ни `tokenDefinitions[name]`) — ошибка автора
   * пакета: тема активируется для ВСЕХ, а вклада от него не будет.
   */
  = | { kind: 'default-theme-without-source', providerId: string, theme: string }
  /**
   * Активная тема есть не у всех провайдеров, объявивших `theme`. Компоненты
   * «отставших» провайдеров в этой теме останутся без токенов.
   */
    | { kind: 'partial-theme', theme: string, providersWithout: readonly string[] }
  /**
   * По умолчанию (без `themes.names`) активирована больше чем одна тема —
   * их блоки эмитятся ОДНОВРЕМЕННО, и если селекторы пересекаются
   * (обе пишут в `:root`), выигрывает последняя по каскаду.
   */
    | { kind: 'multiple-default-themes', themes: readonly string[] }
  /**
   * `define[theme].extends` указывает на тему, эффективные токены которой
   * получить не удалось. Наследовать нечего — тема соберётся из одних лишь
   * собственных `tokens`, и это молчаливый источник «половины палитры».
   *
   *   - `unknown` — темы с таким именем не поставляет никто;
   *   - `opaque` — тема есть, но она приходит готовым CSS-файлом
   *     (`theme.themes[name]`), и её значения пресету не видны.
   */
    | { kind: 'theme-extends-unresolved', theme: string, base: string, reason: 'unknown' | 'opaque' }
  /** Цикл в цепочке `extends`. Цепочка обрывается, темы собираются как есть. */
    | { kind: 'theme-extends-cycle', chain: readonly string[] }

/** Идентификатор «источника» для вкладов, пришедших от самого приложения. */
export const APP_THEME_SOURCE = '(app)'

export interface ResolvedThemeItem {
  providerId: string
  themeName: string
  cssUrl?: string
  tokenDefinition?: GranularThemeTokenSet
  /**
   * Если этот item пришёл от компонента (а не от провайдера) —
   * здесь указано имя компонента-источника. Для провайдерских items — undefined.
   */
  componentName?: string
  /**
   * Item объявлен приложением (`themes.define`), а не пакетом.
   * `providerId` у таких — {@link APP_THEME_SOURCE}.
   */
  appDefined?: true
}

/** Один CSS-блок токенов темы под конкретным селектором. */
export interface ResolvedThemeSelectorBlock {
  selector: string
  tokens: Record<string, string>
}

/**
 * Разрешённые токены одной темы.
 *
 * Тема может содержать НЕСКОЛЬКО блоков под разными селекторами (например,
 * один провайдер эмитит токены под `.dark`, другой — под `[data-theme="dark"]`).
 * Раньше все токены темы схлопывались в один селектор; теперь они группируются
 * по селектору в `blocks` (в порядке первого появления).
 *
 * Поля `selector`/`tokens` — это алиас «первичного» (первого) блока, сохранённый
 * для обратной совместимости и как цель для «плоских» `tokenOverrides`.
 */
export interface ResolvedThemeTokens {
  /** Селектор первичного блока (первого встреченного). */
  selector: string
  /** Токены первичного блока (та же ссылка, что `blocks[0].tokens`). */
  tokens: Record<string, string>
  /** Все блоки темы по селекторам, в порядке первого появления. */
  blocks: ResolvedThemeSelectorBlock[]
}

export interface ResolvedThemes {
  names: readonly string[]
  items: ResolvedThemeItem[]
  /** Слитый реестр токенов по темам: themeName -> { selector, tokens, blocks } */
  tokenRegistry: Record<string, ResolvedThemeTokens>
  /** Откуда взялся `names` — для диагностики (`granular doctor`). */
  namesSource: ThemeNamesSource
  /** Подозрительные, но не фатальные ситуации. Пустой массив — всё чисто. */
  warnings: readonly ResolvedThemeWarning[]
  /**
   * Метаданные тем из `themes.define` (`label`, `colorScheme`) — только для
   * активных тем. Потребитель — манифест и, через него, переключатель тем
   * приложения. На эмит CSS не влияют.
   */
  meta: Readonly<Record<string, GranularThemeMeta>>
}

/**
 * Запись компонента для мержа его собственных `tokenDefinitions` в реестр тем.
 * Передаётся в `resolveThemes` в порядке `resolveSelection` (deps раньше зависящих).
 */
export interface ResolveThemesComponentEntry {
  providerId: string
  descriptor: Pick<GranularComponentDescriptor, 'name' | 'tokenDefinitions'>
}

const DEFAULT_SELECTOR = ':root'

/**
 * Мержит один вклад токенов (`tokenDef`) в реестр темы.
 *
 * Правила по селектору:
 *  - `selector` не задан → токены идут в ПЕРВИЧНЫЙ блок темы (или создают его
 *    с дефолтным `:root`, если тема ещё пуста). Так «безселекторный» вклад
 *    добавляется к уже существующему селектору темы, а не плодит `:root`.
 *  - `selector` задан явно → ищем/создаём блок с этим селектором. Разные
 *    селекторы одной темы дают отдельные CSS-блоки.
 *
 * Значения перезаписываются в порядке вызова (позже — важнее).
 */
function mergeIntoRegistry(
  registry: Record<string, ResolvedThemeTokens>,
  themeName: string,
  tokenDef: GranularThemeTokenSet,
): void {
  const entry = registry[themeName]

  if (!entry) {
    const selector = tokenDef.selector ?? DEFAULT_SELECTOR
    const block: ResolvedThemeSelectorBlock = { selector, tokens: { ...tokenDef.tokens } }
    registry[themeName] = { selector, tokens: block.tokens, blocks: [block] }
    return
  }

  if (tokenDef.selector === undefined) {
    Object.assign(entry.blocks[0].tokens, tokenDef.tokens)
    return
  }

  let block = entry.blocks.find(b => b.selector === tokenDef.selector)
  if (!block) {
    block = { selector: tokenDef.selector, tokens: {} }
    entry.blocks.push(block)
  }
  Object.assign(block.tokens, tokenDef.tokens)
}

/**
 * Для каждого провайдера — пересечение (`themes.names` ∪ дефолт) × `provider.theme`.
 * Если тема задана через tokenDefinitions — она имеет приоритет над themes[name].
 *
 * Если переданы `components`, их `tokenDefinitions` мержатся ПОСЛЕ провайдеров
 * (могут переопределять значения провайдера) — но только для тех тем, которые
 * активны (попали в `names`).
 */
export function resolveThemes(
  providers: readonly GranularProvider[],
  input: ResolveThemesInput = {},
  components: readonly ResolveThemesComponentEntry[] = [],
): ResolvedThemes {
  const define = input.define ?? {}
  const { names, namesSource } = resolveThemeNames(providers, input)

  const warnings = collectThemeWarnings(providers, names, namesSource, define)

  if (names.length === 0)
    return { names: [], items: [], tokenRegistry: {}, namesSource, warnings, meta: {} }

  // Темы, которые надо РЕЗОЛВИТЬ: активные плюс транзитивные базы `extends`.
  // База может не входить в `names` — тогда её значения унаследуются, а сама
  // она в CSS не попадёт (прунинг в конце).
  const plan = planAppThemes(names, define)
  warnings.push(...plan.warnings)
  const resolvedNames = plan.needed

  const items: ResolvedThemeItem[] = []
  const tokenRegistry: Record<string, ResolvedThemeTokens> = {}

  for (const provider of providers) {
    const themeContrib = provider.theme
    if (!themeContrib)
      continue

    for (const themeName of resolvedNames) {
      const tokenDef = themeContrib.tokenDefinitions?.[themeName]
      const cssUrl = themeContrib.themes?.[themeName]

      if (tokenDef) {
        items.push({ providerId: provider.id, themeName, tokenDefinition: tokenDef })
        mergeIntoRegistry(tokenRegistry, themeName, tokenDef)
      }
      else if (cssUrl) {
        items.push({ providerId: provider.id, themeName, cssUrl })
      }
    }
  }

  // Мерж токенов, опубликованных самими компонентами.
  // Выполняется ПОСЛЕ провайдеров — значит компонент может переопределить
  // значение провайдерского токена в рамках одной темы. Порядок `components`
  // соответствует post-order DFS из `resolveSelection` (deps раньше зависящих).
  const activeThemes = new Set(resolvedNames)
  for (const { providerId, descriptor } of components) {
    const componentTokenDefs = descriptor.tokenDefinitions
    if (!componentTokenDefs)
      continue

    for (const themeName of Object.keys(componentTokenDefs)) {
      if (!activeThemes.has(themeName))
        continue

      const tokenDef = componentTokenDefs[themeName]
      if (!tokenDef)
        continue

      items.push({
        providerId,
        componentName: descriptor.name,
        themeName,
        tokenDefinition: tokenDef,
      })
      mergeIntoRegistry(tokenRegistry, themeName, tokenDef)
    }
  }

  // Вклад ПРИЛОЖЕНИЯ — последним слоем и в порядке `plan.order` (базы раньше
  // наследников), чтобы `extends` видел уже полностью собранную базу.
  for (const themeName of plan.order) {
    warnings.push(...applyAppThemeDefinition(
      tokenRegistry,
      items,
      themeName,
      define[themeName]!,
    ))
  }

  // Прунинг: базы, затянутые только ради `extends`, в сборку не идут.
  // Именно это делает «приложение с тремя своими темами и без light/dark»
  // не хаком, а штатным режимом.
  const active = new Set(names)
  const prunedRegistry: Record<string, ResolvedThemeTokens> = {}
  for (const themeName of names) {
    const entry = tokenRegistry[themeName]
    if (entry)
      prunedRegistry[themeName] = entry
  }

  return {
    names,
    items: items.filter(item => active.has(item.themeName)),
    tokenRegistry: prunedRegistry,
    namesSource,
    warnings,
    meta: collectThemeMeta(names, define),
  }
}

/** Все токены темы одной картой: блоки сливаются в порядке объявления. */
function flattenThemeTokens(entry: ResolvedThemeTokens | undefined): Record<string, string> {
  const tokens: Record<string, string> = {}
  for (const block of entry?.blocks ?? [])
    Object.assign(tokens, block.tokens)
  return tokens
}

/**
 * Накладывает определение приложения на уже собранную тему.
 *
 * Две разные операции, и различает их наличие `extends`/`selector`:
 *
 *   1. СТРУКТУРНОЕ определение (`extends` и/или `selector`) — тема схлопывается
 *      в ОДИН блок под целевым селектором: `{ база, ...своё из пакетов,
 *      ...tokens приложения }`. Схлопывание здесь не потеря, а смысл операции:
 *      унаследованные токены обязаны переехать под селектор новой темы, иначе
 *      они остались бы висеть на селекторе базы и активировались вместе с ней.
 *   2. Только `tokens` — обычный точечный мерж в первичный блок темы, как у
 *      компонентов, но с более высоким приоритетом.
 *
 * Чистые метаданные (`label`/`colorScheme`) реестр не трогают.
 */
function applyAppThemeDefinition(
  registry: Record<string, ResolvedThemeTokens>,
  items: ResolvedThemeItem[],
  themeName: string,
  definition: GranularAppThemeDefinition,
): ResolvedThemeWarning[] {
  const warnings: ResolvedThemeWarning[] = []
  const structural = definition.extends !== undefined || definition.selector !== undefined

  let baseTokens: Record<string, string> = {}
  if (definition.extends !== undefined) {
    const baseEntry = registry[definition.extends]
    baseTokens = flattenThemeTokens(baseEntry)
    if (Object.keys(baseTokens).length === 0) {
      warnings.push({
        kind: 'theme-extends-unresolved',
        theme: themeName,
        base: definition.extends,
        // Тема, пришедшая файлом, есть в `items` с `cssUrl`, но в реестре её
        // нет: пресет инлайнит файл как есть и значений не знает.
        reason: items.some(item => item.themeName === definition.extends && item.cssUrl)
          ? 'opaque'
          : 'unknown',
      })
    }
  }

  if (!structural && !definition.tokens)
    return warnings

  if (structural) {
    const selector = definition.selector
      ?? registry[themeName]?.blocks[0]?.selector
      ?? defaultAppThemeSelector(themeName)
    const tokens = {
      ...baseTokens,
      ...flattenThemeTokens(registry[themeName]),
      ...definition.tokens,
    }
    registry[themeName] = { selector, tokens, blocks: [{ selector, tokens }] }
  }
  else {
    mergeIntoRegistry(registry, themeName, { tokens: definition.tokens! })
  }

  items.push({
    providerId: APP_THEME_SOURCE,
    themeName,
    appDefined: true,
    tokenDefinition: {
      selector: registry[themeName].selector,
      tokens: { ...definition.tokens },
    },
  })

  return warnings
}

/** Метаданные активных тем — только те, у кого они реально объявлены. */
function collectThemeMeta(
  names: readonly string[],
  define: Readonly<Record<string, GranularAppThemeDefinition>>,
): Record<string, GranularThemeMeta> {
  const meta: Record<string, GranularThemeMeta> = {}
  for (const name of names) {
    const definition = define[name]
    if (!definition)
      continue
    if (definition.label === undefined && definition.colorScheme === undefined)
      continue
    meta[name] = {
      ...(definition.label !== undefined ? { label: definition.label } : {}),
      ...(definition.colorScheme !== undefined ? { colorScheme: definition.colorScheme } : {}),
    }
  }
  return meta
}

/**
 * План резолва с учётом `extends`: какие темы вообще надо посчитать и в каком
 * порядке применять определения приложения.
 *
 * `needed` — активные темы ПЛЮС транзитивные базы (их надо собрать, чтобы было
 * что наследовать, но в `names` они не попадают). `order` — только темы с
 * определениями, в порядке «база раньше наследника».
 */
function planAppThemes(
  names: readonly string[],
  define: Readonly<Record<string, GranularAppThemeDefinition>>,
): { needed: string[], order: string[], warnings: ResolvedThemeWarning[] } {
  const needed = new Set(names)
  const order: string[] = []
  const warnings: ResolvedThemeWarning[] = []
  const state = new Map<string, 'visiting' | 'done'>()

  const visit = (name: string, chain: readonly string[]): void => {
    const status = state.get(name)
    if (status === 'done')
      return
    if (status === 'visiting') {
      warnings.push({ kind: 'theme-extends-cycle', chain: [...chain, name] })
      return
    }

    const definition = define[name]
    if (!definition) {
      state.set(name, 'done')
      return
    }

    state.set(name, 'visiting')
    if (definition.extends !== undefined) {
      needed.add(definition.extends)
      visit(definition.extends, [...chain, name])
    }
    state.set(name, 'done')
    order.push(name)
  }

  for (const name of names)
    visit(name, [])

  return { needed: [...needed], order, warnings }
}

/**
 * Имена тем, для которых у провайдера есть хоть какой-то вклад.
 *
 * Учитываются ОБА уровня: сам провайдер (`theme.themes` / `theme.tokenDefinitions`)
 * и его компоненты (`descriptor.tokenDefinitions`) — провайдер вправе не иметь
 * package-wide темы вовсе и отдавать токены только из компонентов. Считаем по
 * ОБЪЯВЛЕННЫМ компонентам, а не по выбранным: это проверка контракта пакета,
 * а не конкретной селекции приложения.
 */
function suppliedThemeNames(provider: GranularProvider): Set<string> {
  const names = new Set<string>()
  for (const name of Object.keys(provider.theme?.themes ?? {}))
    names.add(name)
  for (const name of Object.keys(provider.theme?.tokenDefinitions ?? {}))
    names.add(name)
  // Ссылки считаются источником наравне с литералами: node-слой развернёт их
  // до того, как дело дойдёт до эмита CSS. Иначе провайдер, отдающий тему
  // только через `tokenDefinitionsRef`, ложно попадал бы в
  // `default-theme-without-source`.
  for (const name of Object.keys(provider.theme?.tokenDefinitionsRef ?? {}))
    names.add(name)
  for (const component of provider.components) {
    for (const name of Object.keys(component.tokenDefinitions ?? {}))
      names.add(name)
    for (const name of Object.keys(component.tokenDefinitionsRef ?? {}))
      names.add(name)
  }
  return names
}

/**
 * Темы, значения которых понадобятся резолву при данных провайдерах и
 * настройках: активный набор (по правилам {@link resolveThemeNames}) плюс
 * транзитивные базы `extends` из `define`.
 *
 * Нужна node-слою ДО чтения файлов: `tokenDefinitionsRef` материализуются
 * только для этих тем — битая ссылка темы, которую сборка не запрашивала,
 * не должна ни валить конфиг, ни стоить обращения к FS.
 */
export function resolveNeededThemeNames(
  providers: readonly GranularProvider[],
  input: ResolveThemesInput = {},
): Set<string> {
  const { names } = resolveThemeNames(providers, input)
  return new Set(planAppThemes(names, input.define ?? {}).needed)
}

/**
 * Итоговый набор тем и его происхождение.
 *
 * Приоритет источников: явный `names` → ключи `define` → `defaultThemes`
 * провайдеров → фолбэк ядра. `define` стоит выше провайдерских дефолтов
 * намеренно: приложение, объявившее свои темы, владеет списком целиком —
 * иначе к трём кастомным темам молча приехали бы ещё light и dark.
 */
function resolveThemeNames(
  providers: readonly GranularProvider[],
  input: ResolveThemesInput,
): { names: readonly string[], namesSource: ThemeNamesSource } {
  if (input.names !== undefined)
    return { names: input.names, namesSource: 'explicit' }

  const defined = Object.keys(input.define ?? {})
  if (defined.length > 0)
    return { names: defined, namesSource: 'app-defined' }

  return resolveDefaultThemeNames(providers)
}

/**
 * Имена тем по умолчанию — объединение `theme.defaultThemes` всех провайдеров
 * в ПОРЯДКЕ ПРОВАЙДЕРОВ (топологическом: доноры раньше зависящих) с дедупом.
 * Порядок важен: он задаёт порядок блоков в итоговом CSS, а значит и каскад.
 *
 * Если поле не объявил никто — жёсткий фолбэк {@link GRANULAR_DEFAULT_THEME_NAMES}.
 */
function resolveDefaultThemeNames(
  providers: readonly GranularProvider[],
): { names: readonly string[], namesSource: ThemeNamesSource } {
  const names: string[] = []
  const seen = new Set<string>()

  for (const provider of providers) {
    for (const name of provider.theme?.defaultThemes ?? []) {
      if (typeof name !== 'string' || name.length === 0 || seen.has(name))
        continue
      seen.add(name)
      names.push(name)
    }
  }

  if (names.length === 0)
    return { names: GRANULAR_DEFAULT_THEME_NAMES, namesSource: 'fallback' }

  return { names, namesSource: 'provider-defaults' }
}

function collectThemeWarnings(
  providers: readonly GranularProvider[],
  names: readonly string[],
  namesSource: ThemeNamesSource,
  define: Readonly<Record<string, GranularAppThemeDefinition>>,
): ResolvedThemeWarning[] {
  const warnings: ResolvedThemeWarning[] = []
  const supplied = new Map(providers.map(p => [p.id, suppliedThemeNames(p)]))

  // 1. Провайдер объявил тему дефолтной, но сам её не поставляет.
  for (const provider of providers) {
    for (const name of provider.theme?.defaultThemes ?? []) {
      if (!supplied.get(provider.id)!.has(name))
        warnings.push({ kind: 'default-theme-without-source', providerId: provider.id, theme: name })
    }
  }

  // 2. Тема покрыта не всеми провайдерами, которые вообще занимаются темами.
  //    «Занимается» = поставляет хоть одну тему (любую, не обязательно активную).
  //    Провайдер, который тем не касается вовсе (чистый поставщик компонентов
  //    или только base.css), не считается «отставшим».
  //    Темы, которые приложение поставляет САМО (`define` с токенами или
  //    `extends`), из проверки исключены: провайдер и не обязан их знать.
  const themed = providers.filter(p => supplied.get(p.id)!.size > 0)
  if (themed.length > 1) {
    for (const name of names) {
      if (define[name]?.tokens !== undefined || define[name]?.extends !== undefined)
        continue
      const without = themed.filter(p => !supplied.get(p.id)!.has(name)).map(p => p.id)
      if (without.length > 0 && without.length < themed.length)
        warnings.push({ kind: 'partial-theme', theme: name, providersWithout: without })
    }
  }

  // 3. Молча активированы несколько тем сразу.
  if (namesSource === 'provider-defaults' && names.length > 1)
    warnings.push({ kind: 'multiple-default-themes', themes: [...names] })

  return warnings
}
