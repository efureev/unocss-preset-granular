# app-1 — базовый скан одного компонента

Минимальный playground пресета `@feugene/unocss-preset-granular`.

## Для чего

Самый простой сценарий: **один провайдер, один компонент, авто-скан классов**
без `safelist`. `App.vue` намеренно не содержит ни одного собственного класса —
всё, что попадает в CSS, приходит из компонента провайдера.

## Что проверяет

- `presetGranularNode` + обязательный `granularContent(options)` —
  `content.filesystem` собирает globs по выбранному компоненту `XTest1` и
  вытаскивает утилитарные классы из его скомпилированного SFC-чанка в `dist/`.
- `presetMini({ variablePrefix: 'ds-' })` — кастомный префикс CSS-переменных.
- `transformerDirectives()` — раскрытие `@apply` внутри `<style>` SFC.
- `transformerCompileClass()` — сжатие `:uno: …` в один класс `.uno-<hash>`.
- Granular-отбор: `safelist` невыбранного `XTestStyled` в CSS не попадает.
- Разделение вывода на слои через отдельные виртуальные модули
  (`virtual:uno:granular.css` + `virtual:uno.css`), подключаемые в
  фиксированном порядке `reset → granular → app`.

> ℹ️ Файл `granularity-*.css` в сборке **пуст** — и это ожидаемо.
> В granular-слой уходят только preflight'ы пресета: `base.css`/`tokens.css`,
> файлы тем и `cssFiles` компонентов. `@feugene/simple-package` не объявляет
> ничего из этого (стили `XTest1` едут собственным CSS-ассетом пакета), а
> найденные сканом утилиты — обычные правила UnoCSS, они идут в
> `virtual:uno.css`. Пример непустого granular-слоя — app-2 (токены темы) и
> app-3 (`cssFiles` компонента).

## Запуск

```bash
# сначала собрать провайдер (dist/ читается пресетом):
yarn workspace @feugene/simple-package build
yarn workspace @feugene/granular-app-1 dev
```

## Проверка

```bash
yarn workspace @feugene/granular-app-1 build
yarn workspace @feugene/granular-app-1 verify
```

`verify` сверяет собранный CSS с ожиданиями из
[`expected-css.mjs`](./expected-css.mjs): там перечислено, что должно и что НЕ
должно оказаться в выводе. Сама по себе успешная сборка не доказывает ничего —
она остаётся зелёной и тогда, когда классы компонента молча исчезли из CSS.
