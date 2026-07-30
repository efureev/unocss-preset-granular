/**
 * Манифест тем — канал между сборкой и рантаймом.
 *
 * Темы вшиваются в CSS на этапе сборки: пресет эмитит блок токенов под тем
 * селектором, который объявил провайдер (`:root`, `.dark`,
 * `[data-theme="dark"]`, …). Переключение темы в браузере — это всего лишь
 * приведение DOM в состояние, при котором нужный блок начинает совпадать.
 *
 * Загвоздка в том, что ЗНАНИЕ об этих селекторах есть только у сборки, а
 * нужно оно в браузере. Без канала приложение вынуждено дублировать имена тем
 * и их селекторы руками — и расходиться с провайдером молча, потому что
 * несовпавший селектор не даёт ни ошибки, ни предупреждения: просто ничего не
 * переключается.
 *
 * Манифест закрывает этот разрыв: node-слой строит его из ТОЙ ЖЕ резолюции,
 * из которой эмитит CSS.
 *
 * Модуль browser-safe: только типы и чистые функции, никакого FS.
 */

/** Как привести DOM в состояние, при котором тема активна. */
export type GranularThemeActivation
  /**
   * Тема висит на корне (`:root` / `html`) — она активна всегда и
   * «включается» тем, что все остальные выключены. Обычно это базовая тема.
   */
  = | { type: 'root' }
  /** Добавить класс на целевой элемент (`.dark` → `class="dark"`). */
    | { type: 'class', value: string }
  /** Проставить атрибут (`[data-theme="dark"]` → `data-theme="dark"`). */
    | { type: 'attribute', name: string, value: string }
  /**
   * Из селекторов вывести не удалось. Так бывает, когда провайдер поставляет
   * тему готовым CSS-файлом (`theme.themes[name]`): пресет инлайнит файл как
   * есть и не знает, что у него внутри. Лечится либо переходом на
   * `tokenDefinitions` (тогда селектор известен), либо явным
   * `activations` в {@link GranularThemeManifestOptions}.
   */
    | { type: 'unknown' }

/** Одна тема в манифесте. */
export interface GranularThemeEntry {
  name: string
  /** Все селекторы, под которыми эмитятся токены этой темы. */
  selectors: readonly string[]
  activation: GranularThemeActivation
  /** Значения токенов — только если манифест собран с `includeTokens`. */
  tokens?: Readonly<Record<string, Readonly<Record<string, string>>>>
}

export interface GranularThemeManifest {
  /** Темы в порядке, в котором их блоки идут в CSS. */
  themes: readonly GranularThemeEntry[]
  /** Имя первой темы — она же активна, пока никто ничего не переключал. */
  defaultTheme: string
}

const ROOT_SELECTORS = new Set([':root', 'html', ':root:root', 'html:root'])
// Имя CSS-класса: латиница/цифры/дефис/подчёркивание плюс экранированные
// последовательности. Юникодные имена намеренно не поддерживаем — тема с
// не-ASCII селектором лечится явной активацией в `activations`.
const SINGLE_CLASS_RE = /^\.([\w-]+)$/
const ATTRIBUTE_RE = /^\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]$/

/** Разбивает селекторный список на альтернативы: `.a, .b` → `['.a', '.b']`. */
export function splitSelectorList(selector: string): string[] {
  return selector.split(',').map(s => s.trim()).filter(Boolean)
}

/**
 * Выводит способ активации из селекторов темы.
 *
 * Приоритет — атрибут, затем класс, затем корень. Атрибут выбирается первым
 * намеренно: он взаимоисключающий по своей природе (`data-theme` держит одно
 * значение), поэтому переключение между тремя и более темами не требует
 * вычищать классы предыдущей.
 *
 * Селекторы сложнее одного класса или атрибута (комбинаторы, `:where(...)`,
 * псевдоклассы) не поддерживаются: выразить их одной операцией над элементом
 * нельзя. Для них — `activations`-override.
 */
export function resolveThemeActivation(
  selectors: readonly string[],
): GranularThemeActivation {
  const alternatives = selectors.flatMap(splitSelectorList)

  let classFallback: GranularThemeActivation | undefined
  let rootFallback: GranularThemeActivation | undefined

  for (const alternative of alternatives) {
    const attribute = alternative.match(ATTRIBUTE_RE)
    if (attribute) {
      const [, name, quoted, singleQuoted, bare] = attribute
      const value = quoted ?? singleQuoted ?? bare
      // `[data-theme]` без значения активацией быть не может: непонятно, что
      // писать в атрибут.
      if (value !== undefined && value !== '')
        return { type: 'attribute', name, value }
      continue
    }

    const single = alternative.match(SINGLE_CLASS_RE)
    if (single) {
      classFallback ??= { type: 'class', value: single[1] }
      continue
    }

    if (ROOT_SELECTORS.has(alternative))
      rootFallback ??= { type: 'root' }
  }

  return classFallback ?? rootFallback ?? { type: 'unknown' }
}
