/**
 * Что app-1 обязан эмитить. Проверяется `node scripts/verify-apps.mjs app-1`.
 * Смысл каждой строки — в README приложения.
 */
export default {
  purpose: 'минимальный авто-скан одного компонента',

  present: [
    {
      what: 'CSS компонента XTest1 из его SFC <style> (пакет собран отдельно)',
      css: '.x-sp-test',
    },
    {
      what: '@apply внутри <style> раскрыт transformerDirectives',
      css: 'font-weight:700',
    },
    {
      what: 'классы шаблона XTest1 сжаты transformerCompileClass в один класс',
      css: '.uno-',
    },
    {
      what: 'утилита p-4 из шаблона XTest1 найдена файловым сканом',
      css: 'padding:1rem',
    },
    {
      what: 'переменная --brd из border-[var(--brd)] в шаблоне XTest1',
      css: 'var(--brd)',
    },
  ],

  absent: [
    {
      what: 'safelist невыбранного XTestStyled (granular-отбор работает)',
      css: '--card-fg',
    },
    {
      what: 'классы невыбранного XNestedReverse',
      css: 'rounded-3xl',
    },
  ],
}
