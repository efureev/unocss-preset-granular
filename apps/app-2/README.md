# app-2 — safelist + переопределение токенов темы

Playground сценария «динамические классы + токены темы **без** файлового скана».

## Для чего

Показать, что пресет работает и **без** `granularContent(...)`, когда классы
компонента нельзя извлечь статически (они собираются в JS-модуле), а нужные
токены темы задаются приложением.

## Что проверяет

- Компонент `XTestStyled` рендерит `:class="base"`, где `base` — импортированная
  из `dsStyles.ts` строка. Такой класс **невозможно** извлечь статическим
  сканом, поэтому провайдер объявляет его через `safelist`
  (`splitClassTokens(base)`). Это эталонный кейс «safelist только для
  динамики».
- `themes.tokenOverrides.light` (`brd`, `card-fg`) — приложение создаёт токены
  темы `light` «с нуля» (у `simple-package` тема не объявлена). Пресат эмитит
  блок `:root { --brd: …; --card-fg: … }` как preflight.
- Namespace CSS-переменных здесь дефолтный (без `variablePrefix`), поэтому
  токены `--brd` / `--card-fg` совпадают с тем, что использует `dsStyles.ts`.
- Собственные утилиты приложения (`mx-auto flex …` в `App.vue`) сканируются
  стандартным include UnoCSS — файловый скан провайдера здесь намеренно не
  подключён.

> ℹ️ Ключи `tokenOverrides.light` — это **плоская** карта `имя-токена → значение`:
> без префикса `--` (его дописывает генератор) и без уровня селектора — токены
> уходят в первичный блок темы. Есть и вложенная форма
> `{ селектор: { токен: значение } }` — обе описаны в
> [themes-and-tokens.md](../../docs/ru/themes-and-tokens.md#tokenoverrides--две-формы).

## Запуск

```bash
yarn workspace @feugene/simple-package build
yarn workspace @feugene/granular-app-2 dev
```

## Проверка

```bash
yarn workspace @feugene/granular-app-2 build
yarn workspace @feugene/granular-app-2 verify
```

Ожидания — в [`expected-css.mjs`](./expected-css.mjs). Ключевая проверка здесь
«от обратного»: CSS компонента `XTest1` в выводе быть НЕ должно — в этом
приложении файловый скан не подключён намеренно.
