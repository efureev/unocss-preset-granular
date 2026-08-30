# `apps/bench-zero`

Нулевая отметка замера: приложение на голом Vue **без единого импорта из
`@feugene/*` и без UnoCSS**.

## Зачем

Чтобы фраза «компонент стоит N килобайт» имела знаменатель. `dist` этого
стенда — цена пустого Vue-приложения с той же сборочной обвязкой, что у
`bench-one`: тот же `vue`-чанк, тот же ресет, то же расщепление. Разница между
дистрибутивами и есть цена подключения библиотеки.

```
dist/assets/vue-*.js      59 720 B   (gzip 23 256)  рантайм фреймворка
dist/assets/reset-*.css    2 343 B   (gzip  1 029)  @unocss/reset
dist/assets/index-*.js     2 859 B   (gzip  1 286)  код приложения
```

## Что держит стенд нулевым

В `dependencies` ровно `vue`; в `devDependencies` — `@unocss/reset`,
`@vitejs/plugin-vue`, `typescript`, `vite`. Ни `unocss`, ни `@feugene/*`.

`expected-css.mjs` состоит из одних `absent`: стенд существует ради
отсутствия. Как только сюда просочится токен пакета (`--xh-`), preflight
presetMini (`--un-rotate`) или структурный класс (`.xh-`), знаменатель
перестанет быть нулём — молча, потому что сборка от этого не краснеет.

Маркером presetMini выбран именно `--un-rotate`, а не префикс `--un-`:
последний объявляет и сам `@unocss/reset`, который здесь стоит законно.

`expected-budget.mjs` проверяет состав ролей: `vue`, `reset`, `entry` — и
ничего сверх.

## Команды

```bash
yarn workspace @feugene/granular-bench-zero build
node scripts/verify-apps.mjs bench-zero
node scripts/report-css-budget.mjs --stand bench-zero --strict
```
