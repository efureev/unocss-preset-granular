import type { Rule } from '@unocss/core'

/**
 * Утилиты доступности для скринридеров.
 *
 * `clip: rect(0,0,0,0)` формально устарел в пользу `clip-path` — она надёжнее работает в связке
 * с `position: absolute` в старых движках.
 *
 * `not-sr-only` парен `sr-only` и нужен для стандартного приёма
 * «видимо только при фокусе»: `class="sr-only focus:not-sr-only"` — ссылка
 * «перейти к содержимому» проявляется при навигации с клавиатуры.
 */
export const accessibilityRules: Rule[] = [
  ['sr-only', {
    'position': 'absolute',
    'width': '1px',
    'height': '1px',
    'padding': '0',
    'margin': '-1px',
    'overflow': 'hidden',
    'clip': 'rect(0,0,0,0)',
    'white-space': 'nowrap',
    'border-width': 0,
  }],
  // Отменяет `sr-only`, а не «показывает элемент»: `border-width` здесь
  // сознательно не сбрасывается, рамку
  // возвращает то правило border-а, которое стоит на элементе.
  ['not-sr-only', {
    'position': 'static',
    'width': 'auto',
    'height': 'auto',
    'padding': '0',
    'margin': '0',
    'overflow': 'visible',
    'clip': 'auto',
    'white-space': 'normal',
  }],
]
