import type { Preflight, Rule, Variant } from '@unocss/core'

/**
 * Допустимые формы записи зависимости компонента.
 *
 *   1. `'Name'` — имя компонента в ТОМ ЖЕ провайдере, что и текущий.
 *   2. `'providerId:Name'` — квалифицированная ссылка на компонент из другого
 *      (или того же) провайдера.
 *   3. `{ provider, components: [...] }` — объектная форма, удобна когда
 *      из одного провайдера нужно подтянуть сразу несколько компонентов.
 */
export type GranularComponentDependency =
  | string
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
  /** Fallback-имена ассетов для dist без сорцов, позиционно к `cssFiles`. */
  cssFileAssetNames?: readonly string[]
  /** Имя style-asset'а (применяет внешний build при необходимости). */
  styleAssetFileName?: string | null
  /**
   * Абсолютный URL директории исходников компонента (через
   * `new URL(sourceDir, importMetaUrl).href`). Используется node-слоем, чтобы
   * указать UnoCSS, какие файлы пакета сканировать (content.filesystem).
   *
   * Если не задан — резолвер попытается вычислить директорию из
   * `cssFiles[0]` (dirname), либо из `packageBaseUrl + 'components/<Name>/'`.
   */
  sourceDirUrl?: string
  /**
   * Имя ассета-директории исходников относительно `packageBaseUrl`.
   * Fallback для dist-сборки, когда `sourceDirUrl` указывает на несуществующий
   * `src/...`. По смыслу аналогично `cssFileAssetNames`.
   */
  sourceDirAssetName?: string
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
  /** Имена тем, которые подключить, если пользователь не указал `names` явно. */
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
   * Базовый URL пакета (обычно `import.meta.url` корневого модуля).
   * Используется node-слоем для fallback `src/ ↔ dist/`.
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
  safelist: readonly string[]
  cssFiles?: readonly string[]
  /**
   * Если `false` — внешний build НЕ будет эмитить отдельный CSS-ассет
   * для этого компонента. По умолчанию `true`.
   */
  emitStyleAsset?: boolean
  /**
   * Директория исходников компонента относительно `importMetaUrl` (модуля
   * `config.ts`). По умолчанию `'./'` — т.е. директория самого `config.ts`.
   *
   * На основе этого пресет node-уровня сформирует `content.filesystem` для
   * UnoCSS, и классы типа `p-5` из шаблонов будут подхватываться без safelist.
   */
  sourceDir?: string
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
  const sourceDir = options.sourceDir ?? './'
  const normalizedSourceDir = sourceDir.endsWith('/') ? sourceDir : `${sourceDir}/`

  return {
    name: options.name,
    dependencies: [...(options.dependencies ?? [])],
    safelist: [...options.safelist],
    cssFiles: cssFiles.map(file => new URL(file, importMetaUrl).href),
    cssFileAssetNames: cssFiles.map(
      file => `components/${options.name}/${file.replace(/^\.\//, '')}`,
    ),
    styleAssetFileName: options.emitStyleAsset === false
      ? null
      : `components/${options.name}/styles.css`,
    sourceDirUrl: new URL(normalizedSourceDir, importMetaUrl).href,
    sourceDirAssetName: `components/${options.name}/`,
  }
}
