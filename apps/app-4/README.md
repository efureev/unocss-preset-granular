# app-4 — вложенные SFC + доп. правила `unocss-mini-extra-rules`

Playground скана вложенных SFC и интеграции стороннего набора правил.

## Для чего

Проверить два независимых механизма в одной сборке:
1. скан классов из **вложенных** SFC компонента;
2. подключение `@feugene/unocss-mini-extra-rules` поверх `preset-mini`.

## Что проверяет

- Компонент `XNestedReverse` импортирует `../parts/XNestedHeader.vue` и
  `../parts/XNestedFooter.vue`. Так как их импортирует единственный
  entry-компонент, rolldown инлайнит их в `dist/components/XNestedReverse/index.js`,
  и их классы (`text-7xl`, `tracking-widest`, `p-6`, `rounded-3xl`,
  `border-2`, `border-red`) попадают в CSS через файловый скан.
- Наборы правил из `@feugene/unocss-mini-extra-rules`: `animationRules` +
  `animationPreflights` (spinner), `colorOpacityRules` (`bg-[…]/NN`),
  `filterRules` (filter/backdrop-filter), `spacingRules` + `spacingVariants`
  (`space-*` / `divide-*`). `App.vue` использует по классу из каждого набора:
  правила, которые никто не применил, ничего не эмитят — проверять было бы
  нечего.
- Один общий виртуальный модуль `virtual:uno.css` (в отличие от app-1..3 без
  разбиения на слои) — минимальный вариант подключения.

> ℹ️ Вложенные SFC лежат в `reverses/parts/`, а не в `reverses/shared/`: имя
> `shared` зарезервировано контрактом `group-shared`
> (`dist/groups/<group>/shared/`), и совпадение имён сбивало бы с толку.
> `XNestedReverse` не объявляет `group` — пока эти SFC импортирует ровно один
> компонент, они инлайнятся в его entry-чанк и попадают в скан вместе с ним.
> Если тот же SFC понадобится второму компоненту, нужно будет и переложить его
> в `<group>/shared/`, и проставить обоим `group` — иначе rolldown вынесет его
> в общий чанк вне зоны скана, и классы исчезнут из CSS.

> ⚠️ Правила `filterRules` пишут CSS-переменные с префиксом `--un-`, тогда как
> `presetMini` здесь настроен на `variablePrefix: 'ds-'`. Смешивать фильтры из
> этого набора с фильтрами `preset-mini` в одном элементе поэтому нельзя —
> они не увидят переменных друг друга.

## Запуск

```bash
yarn workspace @feugene/simple-package build
yarn workspace @feugene/unocss-mini-extra-rules build
yarn workspace @feugene/granular-app-4 dev
```

## Проверка

```bash
yarn workspace @feugene/granular-app-4 build
yarn workspace @feugene/granular-app-4 verify
```

Ожидания — в [`expected-css.mjs`](./expected-css.mjs): по маркеру на каждый
набор правил плюс классы вложенных SFC, которых нет в `App.vue` (`text-7xl`,
`tracking-widest`, `rounded-3xl`) — они и доказывают, что скан достал их из
собранного чанка компонента.
