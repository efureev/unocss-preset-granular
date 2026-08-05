/**
 * Что app-4 обязан эмитить. Проверяется `node scripts/verify-apps.mjs app-4`.
 */
export default {
  purpose: 'скан вложенных SFC + сторонний набор правил unocss-mini-extra-rules',

  present: [
    {
      what: 'класс из вложенного XNestedHeader (инлайнится в entry-чанк компонента)',
      css: '.text-7xl',
    },
    {
      what: 'класс из вложенного XNestedFooter',
      css: '.tracking-widest',
    },
    {
      what: 'класс собственного шаблона XNestedReverse',
      css: '.rounded-3xl',
    },
    {
      what: 'animationRules',
      css: 'animate-spin{animation:1s linear infinite granularity-spin}',
    },
    {
      what: 'animationPreflights (keyframes отдельно от правила)',
      css: '@keyframes granularity-spin',
    },
    {
      what: 'colorOpacityRules: bracket-цвет с /NN',
      css: 'background-color:#0ea5e94d',
    },
    {
      what: 'filterRules: несколько фильтров через кастомные свойства',
      css: '--un-blur',
    },
    {
      what: 'spacingRules + spacingVariants',
      css: 'space-x-4',
    },
    {
      what: 'accessibilityRules: sr-only',
      css: 'clip:rect(0,0,0,0)',
    },
    {
      what: 'accessibilityRules: not-sr-only под вариантом focus',
      css: 'not-sr-only:focus',
    },
  ],

  absent: [
    {
      what: 'CSS невыбранного XTest1',
      css: '.x-sp-test',
    },
  ],
}
