/**
 * Что app-3 обязан эмитить. Проверяется `node scripts/verify-apps.mjs app-3`.
 */
export default {
  purpose: 'транзитивный донор-провайдер и кросс-пакетные зависимости компонентов',

  present: [
    {
      what: 'cssFiles компонента XgQuick, инлайнутые пресетом в preflight',
      css: '.xg-quick',
    },
    {
      what: 'CSS транзитивного XTest1 из пакета-донора @feugene/simple-package',
      css: '.x-sp-test',
    },
    {
      // Именно этот маркер отличает «скан донора сработал» от «класс написан
      // в App.vue самого приложения»: `var(--brd)` встречается ТОЛЬКО в
      // шаблоне XTest1 внутри пакета-донора.
      what: 'border-[var(--brd)] из шаблона транзитивного XTest1 — скан прошёл по ОБОИМ пакетам',
      css: 'var(--brd)',
    },
  ],

  absent: [
    {
      what: 'safelist XTestStyled — компонент донора, который никто не выбирал',
      css: '--card-fg',
    },
  ],
}
