import type { GranularProvider } from '../contract'
import type { ResolvedThemeItem } from '../core/resolveThemes'
import type { PresetGranularResolution, ThemesOptions } from '../preset'

import type { PresetGranularNodeOptions } from '../preset.node'
import { parseCssCustomPropertyBlocksSync } from './tokenDefinitionsFromCss'

/** Кто дал файл: пакет или приложение. Определяет происхождение его токенов. */
export type InlinedCssOwner = 'provider' | 'app'

/**
 * Роль файла в эмиссии.
 *
 * Различие несёт нагрузку, а не описательность: обрезка токенов режет
 * `tokens` и `theme`, но НЕ трогает `base` — там правила сброса, а не
 * объявления, и «неиспользуемое» правило от нужного статически не отличить.
 * Раньше роль восстанавливалась по отсутствию поля `theme`, то есть `base` и
 * `tokens` были неразличимы.
 */
export type InlinedCssKind = 'tokens' | 'base' | 'theme'

/** Один файл, который пресет инлайнит целиком. */
export interface InlinedCssSource {
  url: string
  /** Роль файла в эмиссии. См. {@link InlinedCssKind}. */
  kind: InlinedCssKind
  /**
   * Человекочитаемая метка автора — та же, что уходит в `GranularCssReadError`:
   * `provider '<id>'` либо `app-override (themes.tokensFile)`.
   */
  origin: string
  owner: InlinedCssOwner
  /** Имя темы — только у файлов тем; у base/tokens `undefined`. */
  theme?: string
}

/** Что известно про токен, пришедший из инлайнимого CSS. */
export interface InlinedToken {
  /** Имя БЕЗ префикса `--`. */
  token: string
  value: string
  selector: string
  /** Метка автора файла (`InlinedCssSource.origin`). */
  origin: string
  owner: InlinedCssOwner
  theme?: string
}

/**
 * Resolve base/tokens/theme URL с учётом override'а — и с указанием, КТО его дал.
 *
 * Владелец возвращается наравне с URL, потому что метка «чей это файл» перестала
 * быть косметикой: из неё выводится происхождение токена в `granular tokens`.
 * Раньше объектная форма override подписывалась как `provider '<id>'`, хотя URL
 * пришёл от приложения.
 */
function pickUrl(
  providerId: string,
  providerUrl: string | undefined,
  override: string | Partial<Record<string, string>> | undefined,
): { url: string | undefined, owner: InlinedCssOwner } {
  if (typeof override === 'string')
    return { url: override, owner: 'app' }
  if (override && typeof override === 'object') {
    const byProvider = override[providerId]
    if (byProvider !== undefined)
      return { url: byProvider, owner: 'app' }
  }
  return { url: providerUrl, owner: 'provider' }
}

/**
 * ВСЕ файлы, которые пресет инлайнит целиком, в порядке эмиссии:
 * `tokens.css` → `base.css` → файлы тем.
 *
 * Чистая функция: ни одного обращения к FS. Единственный источник правды о том,
 * какой файл реально уедет в CSS. Из неё берут и эмиссия
 * (`collectNodeCssSections`), и диагностика — иначе они расходятся на
 * переопределениях: app-override ЗАМЕНЯЕТ провайдерский файл, а не добавляется
 * к нему, и диагностика, складывавшая оба, считала заданным токен, который
 * приложение как раз снесло.
 */
export function resolveInlinedCssSources(
  providers: readonly GranularProvider[],
  items: readonly ResolvedThemeItem[],
  themes: ThemesOptions | undefined,
): InlinedCssSource[] {
  const sources: InlinedCssSource[] = []
  const seen = new Set<string>()
  const add = (url: string | undefined, kind: InlinedCssKind, origin: string, owner: InlinedCssOwner, theme?: string): void => {
    if (url && !seen.has(url)) {
      seen.add(url)
      sources.push(theme === undefined ? { url, kind, origin, owner } : { url, kind, origin, owner, theme })
    }
  }

  // Глобальный строковый override эмитится ОДИН раз и НЕ зависит от того, есть
  // ли у провайдеров `theme` (иначе для провайдера без темы глобальный base не
  // подключался вовсе). Per-providerId override и провайдерские значения
  // берутся по провайдеру и дедуплицируются по итоговому URL.
  const tokensFile = themes?.tokensFile
  if (typeof tokensFile === 'string') {
    add(tokensFile, 'tokens', 'app-override (themes.tokensFile)', 'app')
  }
  else {
    for (const p of providers) {
      const { url, owner } = pickUrl(p.id, p.theme?.tokensCssUrl, tokensFile)
      add(url, 'tokens', owner === 'app' ? `app-override (themes.tokensFile['${p.id}'])` : `provider '${p.id}'`, owner)
    }
  }

  const baseFile = themes?.baseFile
  if (typeof baseFile === 'string') {
    add(baseFile, 'base', 'app-override (themes.baseFile)', 'app')
  }
  else {
    for (const p of providers) {
      const { url, owner } = pickUrl(p.id, p.theme?.baseCssUrl, baseFile)
      add(url, 'base', owner === 'app' ? `app-override (themes.baseFile['${p.id}'])` : `provider '${p.id}'`, owner)
    }
  }

  // Файлы тем. Обход идёт по `items`, и это существенно: `resolveThemes`
  // разводит структурные и файловые темы через `else if`, поэтому item со
  // структурными токенами физически НЕ несёт `cssUrl`. Читать
  // `provider.theme.themes[name]` напрямую значило бы разбирать файл, который
  // в CSS не уедет.
  for (const { providerId, themeName, cssUrl } of items) {
    if (!cssUrl)
      continue
    const override = themes?.themeFiles?.[themeName]
    const { url, owner } = pickUrl(providerId, cssUrl, override)
    add(
      url,
      'theme',
      owner === 'app' ? `app-override (themes.themeFiles['${themeName}'])` : `provider '${providerId}'`,
      owner,
      themeName,
    )
  }

  return sources
}

const inlinedTokensCache = new WeakMap<PresetGranularNodeOptions, Map<string, InlinedToken>>()

/**
 * Токены, объявленные в инлайнимом CSS.
 *
 * Отвечает на вопрос «задаёт ли granular этот токен» для той половины
 * пространства, которую не покрывают структурные слои: провайдер вправе отдать
 * всю палитру обычным `tokens.css`, и тогда `tokenDefinitions` у него пусты, а
 * токены — есть.
 *
 * При конфликте побеждает ПОСЛЕДНИЙ файл в порядке эмиссии: это тот же каскад,
 * по которому их разрешит браузер.
 */
export function collectInlinedTokens(
  options: PresetGranularNodeOptions,
  resolution: PresetGranularResolution,
): Map<string, InlinedToken> {
  const cached = inlinedTokensCache.get(options)
  if (cached)
    return cached

  const found = new Map<string, InlinedToken>()
  for (const source of resolveInlinedCssSources(resolution.providers, resolution.themes.items, options.themes)) {
    let blocks
    try {
      blocks = parseCssCustomPropertyBlocksSync(source.url)
    }
    catch (error) {
      // Нечитаемый или нестандартный CSS не роняет диагностику — но и молчать
      // нельзя: его токены не попадут в «заданные», и каждый потребитель такого
      // токена получит ложную находку `token-undefined` без следа причины.
      console.warn(
        `[granular] cannot read inlined CSS from ${source.origin} (${source.url}): `
        + `${(error as Error)?.message ?? error}. Its tokens will look undefined.`,
      )
      continue
    }
    for (const block of blocks) {
      for (const [token, value] of Object.entries(block.tokens)) {
        found.set(token, source.theme === undefined
          ? { token, value, selector: block.selector, origin: source.origin, owner: source.owner }
          : { token, value, selector: block.selector, origin: source.origin, owner: source.owner, theme: source.theme })
      }
    }
  }

  inlinedTokensCache.set(options, found)
  return found
}
