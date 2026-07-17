# app-1 — базовый скан одного компонента

Минимальный playground пресета `@feugene/unocss-preset-granular`.

## Для чего

Самый простой сценарий: **один провайдер, один компонент, авто-скан классов**
без `safelist`.

## Что проверяет

- `presetGranularNode` + обязательный `granularContent(options)` —
  `content.filesystem` собирает globs по выбранному компоненту `XTest1` и
  вытаскивает утилитарные классы из его скомпилированного SFC-чанка в `dist/`.
- `presetMini({ variablePrefix: 'ds-' })` — кастомный префикс CSS-переменных.
- `transformerDirectives()` — раскрытие `@apply` внутри `<style>` SFC.
- `transformerCompileClass()` — сжатие `:uno: …` в один класс.
- Разделение вывода на слои через отдельные виртуальные модули
  (`virtual:uno:granular.css` + `virtual:uno.css`), подключаемые в
  фиксированном порядке `reset → granular → app`.

## Запуск

```bash
# сначала собрать провайдер (dist/ читается пресетом):
yarn workspace @feugene/simple-package build
yarn workspace @feugene/granular-app-1 dev
```
