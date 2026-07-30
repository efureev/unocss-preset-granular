/**
 * Что app-6 обязан эмитить. Проверяется `node scripts/verify-apps.mjs app-6`.
 *
 * Суть приложения: набор тем принадлежит приложению. Поэтому проверяем две
 * вещи, каждая из которых ломается молча:
 *   1) блоки трёх тем приложения есть, и у каждой свой селектор;
 *   2) тем провайдера в сборке НЕТ — ни `dark`, ни `light`-блока под `:root`.
 */
export default {
  purpose: 'собственные темы приложения вместо провайдерских light/dark',

  present: [
    {
      what: 'блок темы emerald под селектором по умолчанию для app-темы',
      css: '[data-theme=emerald]',
    },
    {
      what: 'блок темы ocean',
      css: '[data-theme=ocean]',
    },
    {
      what: 'блок темы crimson',
      css: '[data-theme=crimson]',
    },
    {
      what: 'токен приложения из литерала (emerald)',
      css: '--app-accent:#10b981',
    },
    {
      // Значения crimson объявлены не в TS, а в src/themes/crimson.css и
      // вычитаны node-слоем через tokensRef.
      what: 'токен приложения, вычитанный из CSS-файла (crimson)',
      css: '--app-accent:#e11d48',
    },
    {
      // Ключевая проверка extends: `light` в сборку не попала, но её значение
      // токена компонента доехало до crimson, где приложение его не трогало.
      what: 'унаследованный от light токен провайдерского компонента',
      css: '--x-tokenized:red',
    },
    {
      what: 'класс компонента XTokenized, использующий токен темы',
      css: 'var(--x-tokenized)',
    },
  ],

  absent: [
    {
      // Провайдер объявляет dark в defaultThemes и поставляет её через
      // XTokenized. Как только приложение объявило свои темы, dark не активна
      // и её блок эмититься не должен.
      what: 'блок темы dark провайдера',
      css: '[data-theme=dark]',
    },
    {
      what: 'класс-активация темы dark провайдера',
      css: '.theme-dark',
    },
    {
      what: 'CSS невыбранного XTest1',
      css: '.x-sp-test',
    },
  ],
}
