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
      css: '--ds-blur',
    },
    {
      what: 'filterRules: @property регистрирует то же имя, на которое ссылается '
        + 'утилита (имя свойства живёт в селекторе, куда postprocess не дотягивается)',
      css: '@property --ds-blur',
    },
    {
      what: 'numericRules: tabular-nums пишет свою переменную, а не свойство',
      css: '--ds-numeric-spacing:tabular-nums',
    },
    {
      what: 'numericPreflights под variablePrefix пресета: иначе утилиты '
        + 'ссылались бы на `--ds-*`, а объявлены были бы `--un-*`',
      css: '--ds-numeric-spacing: ',
    },
    {
      what: 'numericRules: normal-nums сбрасывает свойство целиком',
      css: 'font-variant-numeric:normal',
    },
    {
      what: 'objectRules: object-fit',
      css: 'object-fit:cover',
    },
    {
      what: 'objectRules: object-position из bracket-значения',
      css: 'object-position:50% 20%',
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
    {
      what: 'ни одного `@property --un-*`: у app-4 `variablePrefix: \'ds-\'`, '
        + 'и имя в селекторе обязано ехать через postprocess вместе с entries. '
        + '(Просто `--un-` тут не проверить: `--un-default-border-color` '
        + 'приходит из @unocss/reset — это статический CSS, не генератор.)',
      css: '@property --un-',
    },
    {
      what: 'переменные фильтров под чужим префиксом',
      css: '--un-blur',
    },
    {
      what: 'переменные font-variant-numeric под чужим префиксом',
      css: '--un-numeric-',
    },
  ],
}
