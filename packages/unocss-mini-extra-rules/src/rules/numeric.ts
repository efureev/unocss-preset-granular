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

/**
 * То же мета-поле, что у `presetWind*`. Оно нужно не нам: в режиме
 * `preflight: 'on-demand'` `presetMini` объявляет из `theme.preflightBase`
 * только ключи активированных правил, а читает их отсюда.
 *
 * Без него связка «`presetWind3` + эти правила напрямую» ломается молча:
 * наши правила СТАТИЧЕСКИЕ, а у `presetWind3` — регулярки, и `parseUtil`
 * смотрит статическую карту первой. То есть наше правило перекрывает чужое
 * при любом порядке пресетов, и вместе с ним пропадают заявленные им ключи —
 * `font-variant-numeric` у ВСЕХ утилит семейства, включая правила самого
 * `presetWind3`, собирается из неопределённых переменных.
 */
const NUMERIC_META = { custom: { preflightKeys: [...NUMERIC_VARS] } }

export const numericRules: Rule[] = [
  ['ordinal', withComposed({ '--un-ordinal': 'ordinal' }), NUMERIC_META],
  ['slashed-zero', withComposed({ '--un-slashed-zero': 'slashed-zero' }), NUMERIC_META],
  ['lining-nums', withComposed({ '--un-numeric-figure': 'lining-nums' }), NUMERIC_META],
  ['oldstyle-nums', withComposed({ '--un-numeric-figure': 'oldstyle-nums' }), NUMERIC_META],
  ['proportional-nums', withComposed({ '--un-numeric-spacing': 'proportional-nums' }), NUMERIC_META],
  ['tabular-nums', withComposed({ '--un-numeric-spacing': 'tabular-nums' }), NUMERIC_META],
  ['diagonal-fractions', withComposed({ '--un-numeric-fraction': 'diagonal-fractions' }), NUMERIC_META],
  ['stacked-fractions', withComposed({ '--un-numeric-fraction': 'stacked-fractions' }), NUMERIC_META],
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
