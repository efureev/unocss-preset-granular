# Сканирование компонентов (`content.filesystem`)

> См. также: [Использование в приложениях](./usage-in-apps.md),
> [Написание провайдеров](./authoring-providers.md).

Это механизм, благодаря которому UnoCSS подхватывает статические классы
вроде `class="p-5"` внутри компонента провайдера **без** добавления их в
`safelist`. Это ключевая ценность пресета для потребителя.

## Проблема

По умолчанию UnoCSS сканирует только файлы, проходящие через Vite как
модули. Для провайдера, установленного как npm‑пакет, это значит:

- код шаблона лежит в `node_modules/<pkg>/dist/chunks/*.js` (после
  библиотечной сборки Vite), **а не** в исходниках приложения;
- дефолтный `content.pipeline.include` UnoCSS **исключает** `node_modules`;
- `@unocss/vite` **не мержит** `content.*`, возвращённый пресетом — читает
  `content.filesystem` / `content.pipeline.include` только из top‑level
  `defineConfig({...})`.

Поэтому даже если `presetGranularNode` внутри считает правильные scan
globs, их нужно прокинуть до UnoCSS‑Vite плагина через user‑конфиг.
Именно этим занимается `granularContent(options)`.

## Как работает `granularContent`

```ts
import { presetGranularNode, granularContent } from '@feugene/unocss-preset-granular/node'

const granularOptions = { providers: [...], components: [...] }

export default defineConfig({
  presets: [presetGranularNode(granularOptions)],
  content: granularContent(granularOptions),
})
```

`granularContent(options)` возвращает:

```ts
{
  filesystem: string[],           // абсолютные POSIX‑globs директорий выбранных компонентов
  pipeline: { include: RegExp[] } // расширенный include — чтобы .js чанки из node_modules тоже сканировались
}
```

Внутри он:

1. Резолвит те же `providers` + `components`, что и пресет.
2. Строит **транзитивный граф зависимостей** (в т.ч. cross‑provider). В
   scan‑список попадают только выбранные компоненты и достижимые из них по
   `dependencies` — больше ничего.
3. Для каждого такого компонента вычисляет **единственную** директорию по
   жёсткому контракту:
   `fileURLToPath(new URL('components/<Name>/', provider.packageBaseUrl))`.
   Никакой цепочки кандидатов / эвристик нет — провайдер обязан собрать
   все артефакты компонента (включая чанки от вложенных SFC) под
   `<dist>/components/<Name>/`. Это обеспечивает рецепт `granularChunkFileNames()`
   из `@feugene/unocss-preset-granular/vite` (см. [Рецепт Vite‑сборки](./authoring-providers.md#рецепт-vite-сборки--chunkfilenames)).
   Если директории нет или внутри неё нет `index.js` — компонент пропускается
   с `console.warn`. В режиме `scan: { strict: true }` — бросается
   `GranularProviderContractError`.
4. Нормализует директорию в абсолютный POSIX‑путь, делает `realpath` для
   дедупа между workspace‑симлинками.
5. Генерирует по одному glob на директорию с нужными расширениями (по
   умолчанию: `js,mjs,cjs,ts,mts,cts,jsx,tsx,vue`).

## Что в итоге сканируется

При:

```ts
components: [{ provider: '@feugene/extra-simple-package', names: ['XgQuick'] }]
```

и `XgQuick` с `dependencies: ['@feugene/simple-package:XTest1']` globs
будут примерно такие (пути сокращены):

```
node_modules/@feugene/extra-simple-package/dist/components/XgQuick/**/*.{js,mjs,...,vue}
node_modules/@feugene/simple-package/dist/components/XTest1/**/*.{js,mjs,...,vue}
```

**Другие компоненты этих провайдеров НЕ сканируются** — приложение их не
выбрало, их классы не попадают в итоговый CSS.

## Почему сборка провайдеров имеет значение

Чтобы scan globs попадали в реальный код шаблона, SFC‑чанки должны лежать
**внутри папки компонента** в `dist/`. По умолчанию Vite складывает все
чанки в `dist/chunks/` — которая не сканируется.

Решение — рецепт `chunkFileNames` из
[Написание провайдеров → Рецепт Vite‑сборки](./authoring-providers.md#рецепт-vite-сборки--chunkfilenames).
Любой провайдер, поставляющий Vue SFC и желающий быть "scannable", должен
его применять.

## Опция `scan` — продвинутое

`presetGranularNode({ scan: { ... } })`:

- `enabled: boolean` (по умолчанию `true`) — `false` отключит встроенное
  вычисление scan‑globs (если вы строите их сами).
- `extensions: string[]` — доп. расширения (например, `mdx`).
- `extraGlobs: string[]` — добавляются как есть к сгенерированным.
  Полезно, если нужно сканировать не‑компонентные файлы (helpers/mixins),
  тоже содержащие классы‑литералы.
- `includeNodeModules: boolean` (по умолчанию `true`) — если `false`, любые
  scan‑директории, попадающие в `node_modules`, будут отфильтрованы.
  Полезно при workspace‑симлинках, когда хочется сканировать только
  реальные исходники.
- `strict: boolean` (по умолчанию `false`) — если `true`, нарушение
  layout‑контракта провайдера (нет `<packageBaseUrl>/components/<Name>/`
  или нет `index.js` внутри неё) бросает `GranularProviderContractError`
  вместо `console.warn` + skip.

## Монорепо / workspaces

- Workspace‑линкованные провайдеры через `realpath` резолвятся в реальные
  исходники — пресет дедуплицирует, чтобы один и тот же файл не
  сканировался дважды.
- Контракт layout жёсткий: единственный источник — `<packageBaseUrl>/components/<Name>/`.
  Поэтому ответ «откуда сканировать» однозначен и не зависит от того,
  лежит ли пакет в `node_modules` или симлинком в workspace.

## Грабли (короткий список)

- Забыли `content: granularContent(options)` → классы вроде `p-5` не
  попадают в output. Симптом: работает с `safelist`, ломается без.
  Решение: добавить хелпер.
- Провайдер собран с плоским `dist/chunks/` → тот же симптом; решение —
  применить рецепт `chunkFileNames`.
- `packageBaseUrl` через `new URL('..', import.meta.url)` → становится
  `data:`‑URL; scan‑директории схлопываются в пустоту. Решение —
  runtime‑конкатенация (см. [Написание провайдеров](./authoring-providers.md)).
