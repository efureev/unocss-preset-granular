# app-4 — вложенные SFC + доп. правила `unocss-mini-extra-rules`

Playground скана вложенных SFC и интеграции стороннего набора правил.

## Для чего

Проверить два независимых механизма в одной сборке:
1. скан классов из **вложенных** SFC компонента;
2. подключение `@feugene/unocss-mini-extra-rules` поверх `preset-mini`.

## Что проверяет

- Компонент `XNestedReverse` импортирует `../shared/XNestedHeader.vue` и
  `../shared/XNestedFooter.vue`. Так как их импортирует единственный
  entry-компонент, rolldown инлайнит их в `dist/components/XNestedReverse/index.js`,
  и их классы (`text-7xl`, `tracking-widest`, `p-6`, `rounded-3xl`,
  `border-2`, `border-red`) попадают в CSS через файловый скан.
- Наборы правил из `@feugene/unocss-mini-extra-rules`: `animationRules` +
  `animationPreflights` (spinner), `colorOpacityRules` (`bg-[…]/NN`),
  `filterRules` (filter/backdrop-filter), `spacingRules` + `spacingVariants`
  (`space-*` / `divide-*`).
- Один общий виртуальный модуль `virtual:uno.css` (в отличие от app-1..3 без
  разбиения на слои) — минимальный вариант подключения.

> ℹ️ Папка `reverses/shared/` совпадает по имени с контрактом
> `group-shared`, но `XNestedReverse` **не** объявляет `group`. Пока shared-SFC
> импортирует один компонент — всё инлайнится в его entry и работает; риск
> возникает, только если этот же SFC начнёт использовать второй компонент.
> Подробнее — в `ANALYSIS.md` (пограничные случаи).

## Запуск

```bash
yarn workspace @feugene/simple-package build
yarn workspace @feugene/unocss-mini-extra-rules build
yarn workspace @feugene/granular-app-4 dev
```
