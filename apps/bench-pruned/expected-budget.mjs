/**
 * Ожидаемый бюджет bench-pruned. Проверяется
 * `node scripts/report-css-budget.mjs --stand bench-pruned --strict`.
 *
 * Главная строка здесь — `tokens.maxUnused: 0`. Стенд отличается от
 * `bench-one` одной строкой конфига, и если после обрезки в дистрибутиве
 * остаётся хоть один недостижимый токен — обрезка чего-то не увидела.
 */
export default {
  purpose: 'бюджет того же приложения с включённой обрезкой токенов',

  safelist: {
    deadEntries: ['shadow-legacy'],
    unproven: ['p-2', 'p-3', 'p-4'],
    redundantWithScan: ['border'],
  },

  tokens: {
    undeclaredNoFallback: [],
    minChannels: 3,
    // После обрезки мёртвого груза быть не должно вовсе.
    maxUnused: 0,
  },

  assets: {
    roles: ['vue', 'reset', 'entry', 'granular', 'app', 'pkg'],
  },

  hints: { granularCssGzip: 1156, savedVsBenchOneGzip: 780 },
}
