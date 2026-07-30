# app-3 — транзитивные провайдеры и кросс-пакетные зависимости

Playground композиции провайдеров.

## Для чего

Проверить, что приложению достаточно подключить **один** композитный провайдер,
а его донор развернётся автоматически.

## Что проверяет

- `providers: [extraSimplePkgProvider]` — только композитный провайдер.
  `@feugene/simple-package` подтягивается транзитивно через
  `GranularProvider.dependencies` (см. `expandProviders`).
- Компонент `XgQuick` (`@feugene/extra-simple-package`) объявляет
  `dependencies: ['@feugene/simple-package:XTest1']` — кросс-пакетная
  зависимость на уровне компонента.
- `granularContent(...)` строит globs скана **по обоим** пакетам: и по
  `dist/components/XgQuick/`, и по транзитивному `dist/components/XTest1/`.
  Классы «чужих» невыбранных компонентов доноров в CSS не попадают.
- `cssFiles` компонента `XgQuick` инлайнятся пресетом в granular-слой:
  `@feugene/extra-simple-package` не подключает свой CSS из JS (в его сборке
  нет `libInjectCss`), поэтому единственный способ доставить `.xg-quick` в
  приложение — объявить файл в дескрипторе компонента.
- `transformerDirectives()` включён (без compile-class).

## Запуск

```bash
yarn workspace @feugene/simple-package build
yarn workspace @feugene/extra-simple-package build
yarn workspace @feugene/granular-app-3 dev
```

## Проверка

```bash
yarn workspace @feugene/granular-app-3 build
yarn workspace @feugene/granular-app-3 verify
```

Ожидания — в [`expected-css.mjs`](./expected-css.mjs). Маркером «скан прошёл по
пакету-донору» служит `var(--brd)`: эта строка встречается только в шаблоне
`XTest1` внутри донора и никогда — в исходниках самого приложения. Если убрать
`granularContent(...)` из `uno.config.ts`, проверка падает именно на ней.
