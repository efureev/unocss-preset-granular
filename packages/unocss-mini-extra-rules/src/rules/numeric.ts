import type { Preflight, Rule } from '@unocss/core'

import { toArray } from '@unocss/core'

import { postprocessEntries } from '../internal/vars'

/**
 * Семейство `font-variant-numeric`, которого в `presetMini` нет — оно живёт
 * в `presetWind*`.
 *
 * Отказ такой же тихий, как у `text-transform`: компонент пишет
 * `tabular-nums`, класс остаётся в разметке, CSS не генерируется, и цифры
 * сохраняют пропорциональную ширину. Колонка чисел начинает «дышать» при
 * смене значений — таблица, пагинация, счётчик символов, сетка календаря.
 * Сборка при этом успешна, тесты зелёные, видно только на живой странице.
 *
 * Семейство **композиционное**: `ordinal` и `tabular-nums` задают разные
 * аспекты одного свойства и обязаны пережить друг друга. Поэтому ни одно
 * правило не пишет `font-variant-numeric` напрямую — иначе класс, оказавшийся
 * в CSS последним, затёр бы остальные. Каждая утилита выставляет свою
 * переменную, а свойство собирается из всех пяти, как и в `presetWind*`.
 *
 * Расхождение с `presetWind*` ровно одно: пустые значения по умолчанию тот
 * отдаёт через `preflightKeys` — только для тех ключей, чьи правила реально
 * сработали, — а `numericPreflights` объявляет все пять безусловно. Селектор
 * и вычисленный результат совпадают, но `numericPreflights` нужно подключить
 * рядом с правилами — как `animationPreflights`.
 */

/** Значение «переменная объявлена, но пуста» — то же, что `varEmpty` в UnoCSS. */
const VAR_EMPTY = ' '

const NUMERIC_VARS = [
  '--un-ordinal',
  '--un-slashed-zero',
  '--un-numeric-figure',
  '--un-numeric-spacing',
  '--un-numeric-fraction',
] as const

const COMPOSED = NUMERIC_VARS.map(name => `var(${name})`).join(' ')

function withComposed(entry: Record<string, string>): Record<string, string> {
  return { ...entry, 'font-variant-numeric': COMPOSED }
}

export const numericRules: Rule[] = [
  ['ordinal', withComposed({ '--un-ordinal': 'ordinal' })],
  ['slashed-zero', withComposed({ '--un-slashed-zero': 'slashed-zero' })],
  ['lining-nums', withComposed({ '--un-numeric-figure': 'lining-nums' })],
  ['oldstyle-nums', withComposed({ '--un-numeric-figure': 'oldstyle-nums' })],
  ['proportional-nums', withComposed({ '--un-numeric-spacing': 'proportional-nums' })],
  ['tabular-nums', withComposed({ '--un-numeric-spacing': 'tabular-nums' })],
  ['diagonal-fractions', withComposed({ '--un-numeric-fraction': 'diagonal-fractions' })],
  ['stacked-fractions', withComposed({ '--un-numeric-fraction': 'stacked-fractions' })],
  // Сбрасывает свойство целиком, а не по частям: так же в `presetWind*`, и
  // `normal` — собственное сбрасывающее значение спецификации.
  ['normal-nums', { 'font-variant-numeric': 'normal' }],
]

/**
 * Селекторы сброса — те же, что у `presetMini`, а не `:root`. Разница не
 * косметическая: кастомные свойства наследуются, и с одним `:root` вложенный
 * `ordinal` внутри `tabular-nums` унаследовал бы чужую `--un-numeric-spacing`
 * и получил `ordinal tabular-nums` — там, где `presetWind*` даёт только
 * `ordinal`. Плюс `:root` имеет ту же специфичность, что и класс утилиты, так
 * что победа утилиты держалась бы на порядке слоёв.
 *
 * Значение — дефолт `presetMini`; приложение переопределяет его через
 * `theme.preflightRoot`, и тогда наш блок обязан уехать туда же.
 */
const PREFLIGHT_ROOTS = ['*,::before,::after', '::backdrop']

export const numericPreflights: Preflight[] = [
  {
    getCSS: ({ generator, theme }) => {
      const roots = toArray(
        (theme as { preflightRoot?: string | string[] }).preflightRoot ?? PREFLIGHT_ROOTS,
      )
      if (roots.length === 0)
        return

      // Имена переменных прогоняются через `postprocess` генератора: без этого
      // при `variablePrefix: 'ds-'` утилиты ссылались бы на `--ds-numeric-*`, а
      // preflight объявлял бы `--un-numeric-*` — свойство собралось бы из
      // неопределённых переменных и молча не применилось.
      const entries = postprocessEntries(
        generator,
        NUMERIC_VARS.map(name => [name, VAR_EMPTY]),
        roots[0]!,
      )
      const body = entries.map(([name, value]) => `${name}:${value}`).join(';')

      return roots.map(root => `${root}{${body}}`).join('')
    },
  },
]
