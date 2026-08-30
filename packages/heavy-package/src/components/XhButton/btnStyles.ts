/**
 * Классы `XhButton`, собираемые в рантайме, — источник и `safelist`, и
 * главного вопроса метрики: какие записи `safelist` действительно нужны.
 *
 * Две записи устроены принципиально по-разному:
 *
 *   - ступени `PAD_STEP` склеиваются как `p-${n}` и в клиентском бандле целой
 *     строкой не встречаются НИКОГДА — минификатор оставит `"p-"+n`. Они нужны,
 *     но недоказуемы;
 *   - строки `TONE` уезжают в чанк литералами целиком и потому доказуемы.
 *
 * Метрика обязана различать эти два случая и не называть первый мусором.
 */
export const PAD_STEP = { sm: 2, md: 3, lg: 4 } as const

export const TONE = {
  neutral: 'bg-[var(--xh-btn-bg)] text-[var(--xh-btn-fg)] border-[var(--xh-btn-border)]',
  accent: 'bg-[var(--xh-accent)] text-[var(--xh-accent-fg)] hover:bg-[var(--xh-accent-hover)]',
  danger: 'bg-[var(--xh-danger)] text-[var(--xh-danger-fg)]',
} as const

export type XhButtonSize = keyof typeof PAD_STEP
export type XhButtonTone = keyof typeof TONE

/**
 * Только УТИЛИТЫ. Структурный хук `xh-button` стоит в шаблоне обычным
 * `class` и в `safelist` не попадает: safelist просит UnoCSS СГЕНЕРИРОВАТЬ
 * правило, а у хук-класса правила нет и быть не должно — такая запись мертва
 * по построению.
 */
export const BASE_CLASS = 'border rounded-[var(--xh-radius-sm)]'
