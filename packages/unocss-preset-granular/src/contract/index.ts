import type { Preflight, Rule, Variant } from '@unocss/core'

/** Версия контракта провайдера, поддерживаемая этим пресетом. */
export const GRANULAR_CONTRACT_VERSION = 1 as const

/**
 * Допустимые формы записи зависимости компонента.
 *
 *   1. `'Name'` — имя компонента в ТОМ ЖЕ провайдере, что и текущий.
 *   2. `'providerId:Name'` — квалифицированная ссылка на компонент из другого
 *      (или того же) провайдера.
 *   3. `{ provider, components: [...] }` — объектная форма, удобна когда
 *      из одного провайдера нужно подтянуть сразу несколько компонентов.
 */
export type GranularComponentDependency
  = | string
    | { provider: string, components: readonly string[] }

export interface GranularComponentDescriptor<Name extends string = string> {
  /** Уникальное (внутри провайдера) имя компонента, напр. "DsButton" */
  name: Name
  /**
   * Зависимости компонента. Все зависимости резолвятся через ЕДИНЫЙ РЕЕСТР
   * компонентов, собранный со всех зарегистрированных в `providers` пакетов.
   * Ядро пресета рекурсивно обойдёт граф `dependencies` и автоматически
   * соберёт safelist/cssFiles всех транзитивных зависимостей.
   */
  dependencies?: readonly GranularComponentDependency[]
  /**
   * UnoCSS safelist — классы, которые обязательно попадут в сборку.
   * Сюда входят ТОЛЬКО СОБСТВЕННЫЕ классы компонента.
   */
  safelist?: readonly string[]
  /** Абсолютные URL-строки (через `new URL(..., importMetaUrl).href`) на CSS-файлы компонента. */
  cssFiles?: readonly string[]
  /**
   * Fallback-имена ассетов, сопоставляются с `cssFiles` ПОЗИЦИОННО.
   * Если файл из `cssFiles[i]` не существует, node-слой читает
   * `new URL(cssFileAssetNames[i], packageBaseUrl)`. Рассинхрон длин молча
   * отключает fallback для «хвоста».
   */
  cssFileAssetNames?: readonly string[]
  /**
   * Куда build провайдера должен положить CSS этого компонента:
   * `components/<Name>/styles.css` (или `null`, если сборка ассета отключена
   * через `emitStyleAsset: false`).
   *
   * Потребитель — `granularAssetFileNames()` из
   * `@feugene/unocss-preset-granular/vite`: он воспроизводит ровно этот путь
   * в `output.assetFileNames`. Пресет поле не читает — ему достаточно
   * `cssFileAssetNames`, но обе величины обязаны совпадать по раскладке,
   * иначе fallback чтения CSS в опубликованном пакете упрётся в ENOENT.
   */
  styleAssetFileName?: string | null
  /**
   * Структурные токены, которые ПУБЛИКУЕТ этот компонент для тем.
   * По семантике аналогично `GranularThemeContribution.tokenDefinitions`,
   * но применяется точечно — только когда компонент попадает в селекцию.
   *
   * Ключ — имя темы (`light`, `dark`, ...). Значение — набор токенов БЕЗ
   * префикса `--`. Пресет выгружает значения токенов только для тех тем,
   * которые реально активны в приложении (пересечение с `ThemesOptions.names`).
   *
   * Порядок мержа в итоговый `tokenRegistry` темы:
   *   1) токены провайдеров (`provider.theme.tokenDefinitions`);
   *   2) токены компонентов (в порядке `resolveSelection`) — могут
   *      переопределять значения провайдера.
   */
  tokenDefinitions?: Readonly<Record<string, GranularThemeTokenSet>>
  /**
   * То же, что {@link tokenDefinitions}, но значения не перечислены, а взяты
   * из CSS-файла: `{ light: './themes/light.css' }`.
   *
   * Читает файл node-слой пресета на этапе загрузки конфига, поэтому
   * браузерный `config.ts` остаётся без FS-импортов. Литеральные
   * `tokenDefinitions` для той же темы имеют приоритет над ссылкой.
   *
   * ЗДЕСЬ УЖЕ НЕТ строковой формы, в отличие от
   * {@link DefineGranularComponentOptions.tokenDefinitionsRef}: строку принимает
   * `defineGranularComponent`, а на выходе она нормализована в объект с
   * абсолютным `url` и проставленным `assetName`. Дескриптор — это результат,
   * а не ввод, и потребителю (node-слой, `granularCssAssetsPlugin`) незачем
   * разбирать вариант, которого на этом этапе не бывает.
   *
   * У {@link GranularThemeContribution.tokenDefinitionsRef} объединение
   * остаётся: `defineGranularProvider` — identity-функция, она ничего не
   * нормализует.
   */
  tokenDefinitionsRef?: Readonly<Record<string, GranularThemeTokenRef>>
  /**
   * Идентификатор группы компонентов, шарящих общие SFC-чанки.
   *
   * Если задан, дополнительно к `dist/components/<Name>/` пресет
   * сканирует `dist/groups/<group>/shared/` — туда build провайдера
   * (через `granularChunkFileNames`) кладёт чанки SFC, которые
   * импортируются несколькими entry-компонентами одной группы
   * (типичный layout: `src/components/<group>/shared/<File>.vue`).
   *
   * Без `group` shared-папка не сканируется — компонент изолирован.
   */
  group?: string
}

/**
 * ДЕКЛАРАТИВНАЯ ссылка на CSS-файл, из которого node-слой пресета сам вычитает
 * токены темы.
 *
 * Зачем: без неё провайдер, желающий отдать структурные токены, обязан позвать
 * `tokenDefinitionsFromCssSync` из `/node` — а этот импорт, попав в браузерный
 * `config.ts`, утаскивает `node:fs` в клиентский бандл (сборка при этом не
 * падает, ломается рантайм у потребителя). Обходить приходилось вторым файлом
 * `config.node.ts`. Ссылка — это просто данные, её можно объявлять в
 * браузерном конфиге, а читает файл пресет.
 *
 * Строковая форма — сокращение для `{ url }` с настройками по умолчанию.
 */
export interface GranularThemeTokenRef {
  /**
   * Путь к CSS. В `defineGranularComponent`/`defineGranularProvider`
   * относительный путь резолвится от `import.meta.url` вызывающего модуля,
   * как и `cssFiles`.
   */
  url: string
  /** Какой селектор извлечь из файла. По умолчанию `:root`. */
  selector?: string
  /** Под каким селектором эмитить (например, забрать `:root`, выдать `.dark`). */
  as?: string
  /**
   * Строгий режим парсера. По умолчанию `true`: отсутствие запрошенного
   * селектора или неподдерживаемая вложенность — ошибка, а не тихо пустая тема.
   */
  strict?: boolean
  /**
   * Имя ассета для fallback'а — как `cssFileAssetNames` у `cssFiles`.
   * Проставляется `define*`-хелперами; нужно, когда пакет опубликован без
   * исходников и `url` указывает в несуществующий `src/`.
   */
  assetName?: string
}

export interface GranularThemeTokenSet {
  /**
   * CSS-селектор для токенов (например `:root` или `[data-theme="dark"]`).
   * Если не указан — используется селектор первого провайдера для этой темы.
   */
  selector?: string
  /** Карта токенов БЕЗ префикса `--`. */
  tokens: Readonly<Record<string, string>>
}

export interface GranularThemeContribution {
  /** Базовый CSS (reset/layout-base), подключается один раз. */
  baseCssUrl?: string
  /** CSS с общими токенами, не зависящими от темы. */
  tokensCssUrl?: string
  /**
   * Темы, которые провайдер поддерживает.
   * Ключ — имя темы (`light`, `dark`, `corporate`, ...), значение —
   * URL/path на CSS-файл с токенами этой темы. Подключается только
   * пересечение этого словаря с `ThemesOptions.names` приложения.
   */
  themes?: Readonly<Record<string, string>>
  /**
   * Структурное определение токенов темы.
   * Если задано для темы X, пресет использует его вместо `themes[X]` у этого же провайдера.
   * Позволяет приложению делать точечные overrides.
   */
  tokenDefinitions?: Readonly<Record<string, GranularThemeTokenSet>>
  /**
   * Package-wide аналог {@link GranularComponentDescriptor.tokenDefinitionsRef}:
   * токены темы вычитываются node-слоем из указанного CSS.
   *
   * Строковая форма ЗДЕСЬ ОСТАЁТСЯ намеренно — не приводить к дескрипторному
   * варианту. `defineGranularProvider` — identity-функция: она не резолвит
   * относительный путь и не проставляет `assetName`. Практическое следствие —
   * разместить такую ссылку в `dist` нечем, поэтому package-wide ссылки
   * объявляют литералом `new URL(..., import.meta.url)`;
   * `granularCssAssetsPlugin` сообщает о прочих (`reason: 'no-asset-name'`).
   */
  tokenDefinitionsRef?: Readonly<Record<string, GranularThemeTokenRef | string>>
  /**
   * Имена тем, которые подключить, если приложение не указало
   * `themes.names` явно.
   *
   * Итоговый набор — объединение `defaultThemes` ВСЕХ провайдеров резолюции
   * (включая транзитивных доноров) в порядке провайдеров, с дедупом. Если
   * поле не объявил никто — фолбэк `['light']`. `themes.names: []` остаётся
   * «тем нет» и это поле не смотрит.
   *
   * Объявляй сюда только те темы, которые провайдер реально поставляет
   * (`themes[name]` или `tokenDefinitions[name]`): тема активируется для
   * всей сборки, и «пустое» объявление оставит без токенов чужие компоненты.
   * `granular doctor` показывает такие случаи.
   */
  defaultThemes?: readonly string[]
}

export interface GranularUnocssContribution {
  rules?: readonly Rule[]
  variants?: readonly Variant[]
  /** Inline-preflights, не требующие FS. */
  preflights?: readonly Preflight[]
}

export interface GranularProvider {
  /** Уникальный id провайдера, напр. "@feugene/granularity". */
  id: string
  /** Версия контракта — для будущей совместимости. */
  contractVersion: 1
  /**
   * Базовый URL ДИРЕКТОРИИ пакета (не модуля) — от него node-слой резолвит
   * `cssFileAssetNames` (fallback чтения CSS) и `components/<Name>/`
   * (директории сканирования).
   *
   * Один и тот же код провайдера работает и из исходников, и из `dist/`
   * именно потому, что этот URL указывает на корень СВОЕЙ раскладки —
   * никакого «зондирования соседней `src/`/`dist/`» в пресете нет.
   */
  packageBaseUrl: string
  components: readonly GranularComponentDescriptor[]
  theme?: GranularThemeContribution
  unocss?: GranularUnocssContribution
  /**
   * Провайдеры, от которых зависит этот провайдер (композиция на уровне
   * пакетов). Ядро пресета рекурсивно разворачивает граф `dependencies`,
   * дедуплицирует по `id` и упорядочивает топологически (зависимости
   * раньше зависимых). Это позволяет композитному провайдеру быть
   * самодостаточным — приложению достаточно перечислить только его,
   * без явного упоминания «доноров».
   *
   * Формы записи:
   *   1. `GranularProvider` — готовый инстанс донора (рекомендуется).
   *   2. `string` — `id` провайдера, который обязан присутствовать в
   *      `providers[]` приложения (или быть притянут другим инстансом).
   *      Если к концу резолва такого id нет — пресет бросит
   *      `UnresolvedProviderDependencyError`.
   *
   * Семантика: добавление провайдера‑зависимости НЕ включает автоматически
   * все его компоненты. Селекция компонентов по‑прежнему остаётся за
   * приложением (`options.components`) или графом `component.dependencies`.
   */
  dependencies?: readonly (GranularProvider | string)[]
}

/** Хелпер-идентити для автодополнения при объявлении провайдера. */
export function defineGranularProvider<P extends GranularProvider>(provider: P): P {
  return provider
}

export interface DefineGranularComponentOptions<Name extends string = string> {
  name: Name
  dependencies?: readonly GranularComponentDependency[]
  safelist?: readonly string[]
  cssFiles?: readonly string[]
  /**
   * Если `false` — внешний build НЕ будет эмитить отдельный CSS-ассет
   * для этого компонента. По умолчанию `true`.
   */
  emitStyleAsset?: boolean
  /**
   * Структурные токены, публикуемые компонентом для тем приложения.
   * См. `GranularComponentDescriptor.tokenDefinitions`.
   */
  tokenDefinitions?: Readonly<Record<string, GranularThemeTokenSet>>
  /**
   * Ссылки на CSS с токенами тем: `{ light: './themes/light.css' }`.
   * Относительные пути резолвятся от `importMetaUrl`, как и `cssFiles`.
   *
   * Это ВВОД, поэтому строковая форма разрешена: `defineGranularComponent`
   * нормализует её в объект. В самом дескрипторе объединения уже нет —
   * см. `GranularComponentDescriptor.tokenDefinitionsRef`.
   */
  tokenDefinitionsRef?: Readonly<Record<string, GranularThemeTokenRef | string>>
  /**
   * Идентификатор группы компонентов, шарящих общие SFC.
   * См. `GranularComponentDescriptor.group`.
   */
  group?: string
}

/**
 * Создаёт дескриптор компонента, резолвя `cssFiles` в абсолютные URL через
 * `import.meta.url` вызывающего модуля. Используется провайдерами в их
 * `components/<Name>/config.ts`.
 */
export function defineGranularComponent<Name extends string>(
  importMetaUrl: string,
  options: DefineGranularComponentOptions<Name>,
): GranularComponentDescriptor<Name> {
  const cssFiles = options.cssFiles ?? []

  return {
    name: options.name,
    dependencies: [...(options.dependencies ?? [])],
    safelist: [...(options.safelist ?? [])],
    cssFiles: cssFiles.map(file => new URL(file, importMetaUrl).href),
    cssFileAssetNames: cssFiles.map(
      file => `components/${options.name}/${file.replace(/^\.\//, '')}`,
    ),
    styleAssetFileName: options.emitStyleAsset === false
      ? null
      : `components/${options.name}/styles.css`,
    ...(options.tokenDefinitions ? { tokenDefinitions: options.tokenDefinitions } : {}),
    ...(options.tokenDefinitionsRef
      ? { tokenDefinitionsRef: resolveTokenRefs(options.tokenDefinitionsRef, importMetaUrl, options.name) }
      : {}),
    ...(options.group ? { group: options.group } : {}),
  }
}

/**
 * Приводит ссылки к абсолютным URL и проставляет `assetName` — имя, по
 * которому node-слой найдёт файл в опубликованном пакете (там `src/` нет).
 * Ровно та же схема, что у пары `cssFiles` / `cssFileAssetNames`.
 */
function resolveTokenRefs(
  refs: Readonly<Record<string, GranularThemeTokenRef | string>>,
  importMetaUrl: string,
  componentName?: string,
): Record<string, GranularThemeTokenRef> {
  return Object.fromEntries(
    Object.entries(refs).map(([theme, ref]) => {
      const normalized: GranularThemeTokenRef = typeof ref === 'string' ? { url: ref } : { ...ref }
      const relative = normalized.url.replace(/^\.\//, '')

      return [theme, {
        ...normalized,
        url: new URL(normalized.url, importMetaUrl).href,
        assetName: normalized.assetName
          ?? (componentName ? `components/${componentName}/${relative}` : relative),
      }]
    }),
  )
}

/**
 * Базовый URL пакета для `GranularProvider.packageBaseUrl`.
 *
 * Заменяет копипасту вида
 * `` `${import.meta.url.slice(0, import.meta.url.lastIndexOf('/', ...))}` ``,
 * которую до сих пор приходилось переносить из провайдера в провайдер.
 *
 * ```ts
 * // granular-provider/index.ts (лежит на один уровень ниже корня раскладки)
 * packageBaseUrl: resolvePackageBaseUrl(import.meta.url)
 * ```
 *
 * Почему не `new URL('..', import.meta.url)` на стороне провайдера: Vite и
 * rolldown распознают ИМЕННО этот литерал и заменяют его на `data:`-URL при
 * сборке — скан-директории после этого схлопываются в ничто, молча. Здесь
 * база приходит аргументом, статически подставить бандлеру нечего.
 *
 * @param importMetaUrl `import.meta.url` вызывающего модуля.
 * @param levelsUp Сколько уровней подняться от модуля до корня раскладки
 *   пакета. По умолчанию `1` — модуль лежит в подкаталоге
 *   (`<base>/granular-provider/index.js`, а в сборке — `<base>/chunks/*.js`).
 *
 * ВАЖНО: значение зависит от того, куда бандлер положит ЭТОТ модуль, а не от
 * структуры исходников. Проверяйте результат через `npx granular doctor` —
 * неверная база даёт пустой скан, а не ошибку.
 */
export function resolvePackageBaseUrl(importMetaUrl: string, levelsUp = 1): string {
  if (typeof importMetaUrl !== 'string' || importMetaUrl.length === 0)
    throw new TypeError('resolvePackageBaseUrl: importMetaUrl must be a non-empty string')
  if (!Number.isInteger(levelsUp) || levelsUp < 0)
    throw new TypeError(`resolvePackageBaseUrl: levelsUp must be a non-negative integer, got ${levelsUp}`)

  // Отрезаем имя файла, затем — по одному сегменту на каждый уровень.
  let end = importMetaUrl.lastIndexOf('/')
  if (end < 0)
    throw new TypeError(`resolvePackageBaseUrl: '${importMetaUrl}' has no path separator`)

  for (let i = 0; i < levelsUp; i++) {
    const next = importMetaUrl.lastIndexOf('/', end - 1)
    if (next < 0)
      throw new RangeError(`resolvePackageBaseUrl: cannot go ${levelsUp} level(s) up from '${importMetaUrl}'`)
    end = next
  }

  return importMetaUrl.slice(0, end + 1)
}
