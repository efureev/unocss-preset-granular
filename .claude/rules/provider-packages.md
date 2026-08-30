---
paths:
  - "packages/simple-package/**"
  - "packages/extra-simple-package/**"
  - "packages/heavy-package/**"
  - "packages/unocss-mini-extra-rules/**"
---

> **Применяется когда:** добавляешь или правишь компонент провайдера, его `config.ts`,
> `granular-provider/`, `vite.config.ts` или темы пакета.
> **Не нужно:** при работе с самим пресетом (`.claude/rules/preset-core.md`) и с
> `uno.config.ts` приложений (`apps.md`).
> **Смежное:** `docs/ru/authoring-providers.md`, `docs/ru/component-authoring.md`,
> `.claude/docs/gotchas.md`.

Эти пакеты — не только демо: они единственная проверка того, что контракт вообще
исполним. Ломающее их изменение ломает контракт.

## Layout-контракт публикации

Пресет ищет ровно одно место — `<packageBaseUrl>/components/<Name>/`, и внутри
обязателен `index.js`. Нет директории или входа — компонент молча выпадает из
сканирования (`console.warn`, не ошибка), и его классы исчезают из CSS.

Отсюда следует, что каждый granular-компонент обязан быть **отдельным entry** в
`build.lib.entry` своего `vite.config.ts`, а `chunkFileNames` — это
`granularChunkFileNames()` из `@feugene/unocss-preset-granular/vite`. Дефолтный Vite
сваливает чанки в плоский `dist/chunks/`, который не сканируется.

Общий SFC двух и более компонентов кладётся в `src/components/<group>/shared/`, а
компоненты объявляют одинаковый `group` — тогда чанк уезжает в
`dist/groups/<group>/shared/` и попадает в скан. Без `group` shared-папка не
сканируется вовсе.

## Что нельзя делать в `components/*/config.ts`

**Импортировать `@feugene/unocss-preset-granular/node`.** `config.ts` попадает в
браузерный экспорт `./granular-provider`, и `/node` утянет `node:fs` в клиентский
бандл. Сборка при этом НЕ падает — ломается рантайм у потребителя.

Нужны токены, вычитанные из CSS, — объявляй ССЫЛКУ, а не читай файл сам:

```ts
// components/XTokenized/config.ts — ни /node, ни второго файла
export const xTokenizedConfig = defineGranularComponent(import.meta.url, {
  name: 'XTokenized',
  tokenDefinitionsRef: {
    // Литерал `new URL(...)` обязателен, если файл не эмитится сборкой сам:
    // именно на него реагирует бандлер (обычно инлайнит data:-URL).
    light: new URL('./themes/light.css', import.meta.url).href,
    dark: { url: new URL('./themes/dark.css', import.meta.url).href, as: '.dark' },
  },
})
```

Файл читает node-слой пресета при загрузке конфига приложения. Образец —
`packages/simple-package/src/components/XTokenized/config.ts`.

Парный `config.node.ts` нужен только под произвольные node-вычисления, которых
ссылкой не выразить. Тогда `granular-provider/index.ts` экспортирует фабрику
(`createXProvider(components)`) и браузерный вариант, а `granular-provider/node.ts`
зовёт ту же фабрику с `*.node`-компонентами — чтобы варианты не разъехались по `id`
и `packageBaseUrl`.

**То же для доноров.** Браузерный `granular-provider/index.ts` должен импортировать
БРАУЗЕРНЫЙ entry донора (`@feugene/simple-package/granular-provider`), иначе node-слой
приедет в клиент транзитивно; node-вариант донора подставляется в `node.ts`.
Образец — `packages/extra-simple-package`.

Проверка — по собранному бандлу, а не по исходникам:

```bash
grep -rn "unocss-preset-granular/node" packages/<pkg>/dist/granular-provider.js \
  packages/<pkg>/dist/chunks/*.js   # должно быть пусто
```

**Писать `new URL('..', import.meta.url)` для `packageBaseUrl`.** Vite/Rolldown
заменяет этот литерал на `data:`-URL при сборке, и скан-директории схлопываются в
ничто. Используй `resolvePackageBaseUrl(import.meta.url)` из `./contract` — рукописный
слайс `import.meta.url` больше не нужен (оба провайдера уже переведены). Второй
аргумент `levelsUp` — если модуль лежит глубже одного уровня от корня раскладки.

**Писать ключи токенов с `--`.** `tokens: { brand: '#fff' }`, не `{ '--brand': ... }`.

## `packageBaseUrl` зависит от того, куда бандлер положит модуль

`resolvePackageBaseUrl(import.meta.url)` считает базу от МЕСТА СБОРКИ модуля, а
не от структуры исходников, и дефолтный `levelsUp: 1` верен для
`<base>/<подкаталог>/`. Общий чанк ролдаун волен ИНЛАЙНИТЬ в entry — тогда
модуль оказывается в `dist/` корнем, база уезжает на уровень выше пакета, скан
пустеет, и всё это без единой ошибки.

Надёжный приём — сделать носителя базы ЯВНЫМ entry с вложенным путём
(`'granular-provider/shared'` → `dist/granular-provider/shared.js`): такой
свободы у бандлера не остаётся. Образец — `packages/heavy-package`. Проверка
после сборки:

```bash
node -e "import('./packages/<pkg>/dist/granular-provider.js').then(m => console.log(m.default.packageBaseUrl))"
```

Должно оканчиваться на `/dist/`.

## Токены, адресуемые в рантайме

Имя, собираемое как `` `var(${nameFromProp})` ``, не найдёт никакой статический
скан. Объявляй такие токены в `dynamicTokens` **компонента**, который их
читает, — иначе приложение с включённой обрезкой (`pruneTokens`) удалит их
объявления молча.

На компоненте, а не на провайдере: провайдерский список держал бы токен и в
сборках, где этого компонента нет, то есть ровно тот перерасход, ради
устранения которого существует гранулярный отбор. Поле опционально, контракт
остаётся версии 1.

Особенно коварен случай, когда имя лежит в ОБЩЕМ модуле (композабл, который
импортируют несколько компонентов): бандлер выносит его в чанк вне
`components/<Name>/`, и канал строковых литералов туда не заглядывает.
`granular prune` про такое предупреждает отдельной строкой.

## Сборка: два хелпера из `./vite`, не один

`chunkFileNames: granularChunkFileNames()` — SFC-чанки в `components/<Name>/chunks/`.
`assetFileNames: granularAssetFileNames({ components })` — CSS компонента в
`components/<Name>/styles.css`, туда же, куда `defineGranularComponent` записывает
`styleAssetFileName`/`cssFileAssetNames`. Без второго CSS ложится плоско
(`dist/XTest1.css`), и fallback чтения CSS в опубликованном пакете (без исходников)
упирается в ENOENT. Требует `build.cssCodeSplit: true`.

## После правки

Пересобери пакет и убедись, что layout цел:

```bash
yarn build:packages
ls packages/simple-package/dist/components/<Name>/index.js
ls packages/simple-package/dist/components/<Name>/styles.css   # если у компонента есть стили
```

Затем прогони приложение, которое этот компонент использует, — только сборка
приложения показывает, доехали ли классы до CSS. См. `.claude/docs/gotchas.md`.