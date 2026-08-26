/**
 * Правила локалей: как объявленный тег превращается в имя импорта и какой из
 * объявленных тегов обслуживает запрошенный.
 *
 * Оба правила реализованы здесь, а не взяты из `fint-i18n`: пресет не зависит
 * от i18n-рантайма и не должен начать. Зеркалятся `negotiateLocale` и
 * `LoaderRegistry.resolve` — расхождение поймает гейт пакета, а не молчаливый
 * промах на чужой сборке.
 *
 * Чистые функции, ни FS, ни зависимостей.
 */

/** Базовый язык тега: `ru-RU` → `ru`. Тег без подтега базового языка не имеет. */
function baseLanguage(tag: string): string | undefined {
  const dash = tag.indexOf('-')

  return dash > 0 ? tag.slice(0, dash) : undefined
}

const IDENTIFIER = /^[a-z_$][\w$]*$/i

/** Может ли строка быть именем именованного импорта. */
export function isValidExportName(name: string): boolean {
  return IDENTIFIER.test(name)
}

/**
 * Имя именованного экспорта для тега: `pt-BR` → `ptBR`.
 *
 * Дефис в идентификаторе стоять не может, поэтому теги с регионом пакеты
 * экспортируют в camelCase — конвенция `fint-i18n` («Authoring localization
 * packages», Package contract, п. 1). Пакет, отступивший от неё, объявляет имя
 * явно через `i18n.exportNames`.
 */
export function localeExportName(locale: string): string {
  const [head = '', ...rest] = locale.split('-')

  return head + rest.map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('')
}

/** Каким шагом каскада объявленный тег нашёлся под запрошенный. */
export type GranularLocaleMatchKind = 'exact' | 'base' | 'region'

export interface GranularLocaleMatch {
  /** Объявленный пакетом тег — он же верхний ключ коллекции лоадеров. */
  locale: string
  via: GranularLocaleMatchKind
  /** Прочие кандидаты того же шага; непусто только у неоднозначного `region`. */
  alternatives: readonly string[]
}

/**
 * Какой из объявленных тегов обслуживает запрошенный.
 *
 * Каскад повторяет `negotiateLocale` и останавливается на ПЕРВОМ попадании —
 * поэтому на запрошенный тег приходится ровно один объявленный, и `ru` с
 * `ru-RU` не могут уехать в бандл вдвоём как два импорта одного словаря.
 *
 * 1. `exact` — совпадение без учёта регистра: теги BCP 47 регистронезависимы;
 * 2. `base` — базовый язык запрошенного: `ru-RU` обслуживается лоадерами `ru`;
 * 3. `region` — обратный шаг: запрошен `ru`, а объявлен только `ru-RU`.
 *
 * Третий шаг есть потому, что манифест отвечает на вопрос «что попадёт в
 * бандл», а это вопрос ДОСТУПНОСТИ. Без него пакет молча выпадет из сборки, и
 * `negotiateLocale` в рантайме не сможет выбрать то, что выбрал бы: локали нет
 * в бандле — значит нет и в `getAvailableLocales()`.
 *
 * Базовый язык берётся усечением на ОДИН уровень (`indexOf('-')`), как в
 * `fint-i18n`: для `zh-Hans-CN` это `zh`, а не `zh-Hans`. Промежуточный тег
 * подхватывает третий шаг, но объявленный `zh` выиграет у более точного
 * `zh-Hans`. Порядок шагов повторяется намеренно: расхождение с рантаймом
 * дороже неточности — пресет отобрал бы лоадер, который никто не возьмёт.
 */
export function matchLocale(
  declared: readonly string[],
  requested: string,
): GranularLocaleMatch | undefined {
  const want = requested.toLowerCase()

  const exact = declared.find(locale => locale.toLowerCase() === want)
  if (exact !== undefined)
    return { locale: exact, via: 'exact', alternatives: [] }

  const base = baseLanguage(want)
  if (base !== undefined) {
    const byBase = declared.find(locale => locale.toLowerCase() === base)
    if (byBase !== undefined)
      return { locale: byBase, via: 'base', alternatives: [] }
  }

  const prefix = `${base ?? want}-`
  const regional = declared.filter(locale => locale.toLowerCase().startsWith(prefix))
  if (regional.length > 0)
    return { locale: regional[0], via: 'region', alternatives: regional.slice(1) }

  return undefined
}
