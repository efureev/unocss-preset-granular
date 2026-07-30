/**
 * Что app-2 обязан эмитить. Проверяется `node scripts/verify-apps.mjs app-2`.
 */
export default {
  purpose: 'safelist для динамических классов + tokenOverrides, без файлового скана',

  present: [
    {
      what: 'блок токенов темы, созданный приложением через themes.tokenOverrides',
      css: '--brd:#02f8fa',
    },
    {
      what: 'второй токен того же блока',
      css: '--card-fg:#af172a',
    },
    {
      what: 'класс из safelist XTestStyled (собирается в JS, статически не извлекается)',
      css: 'var(--card)',
    },
  ],

  absent: [
    {
      what: 'CSS компонента XTest1 — он не выбран',
      css: '.x-sp-test',
    },
  ],
}
