# Рецепты и отладка

Растущий список вопросов, которые возникают чаще всего.

## «`p-5` из компонента провайдера не попадает в итоговый CSS»

По убыванию вероятности:

1. **Нет `granularContent(options)` в `uno.config.ts`.** Плагин UnoCSS для
   Vite игнорирует preset‑level `content.*`. Добавьте:

   ```ts
   content: granularContent(granularOptions),
   ```

   См. [Сканирование компонентов](./component-scanning.md).

2. **Провайдер собран с плоским `dist/chunks/`.** Тело SFC находится вне
   scan‑директории компонента. Примените рецепт `chunkFileNames` из
   [Написание провайдеров](./authoring-providers.md#рецепт-vite-сборки--chunkfilenames).

3. **`packageBaseUrl` провайдера собран как `new URL('..', import.meta.url)`.**
   Rolldown подменит литерал на `data:`‑URL — scan‑globs схлопнутся.
   Используйте runtime‑конкатенацию (см. `authoring-providers.md`).

4. **Класс динамический, а не статический** (например, `` :class="`p-${n}`" ``).
   Экстрактор его не увидит. Либо переписать на статический, либо
   перечислить в `safelist`.

## «`'all'` тянет слишком много CSS»

Это by design — `components: 'all'` явно отключает гранулярный выбор.
Используйте только для demo/playground. В продакшене перечисляйте
конкретные компоненты.

## «HMR не подхватывает новый класс из исходников провайдера»

`content.filesystem` подключён к watcher'у, но только для директорий из
сгенерированных globs. Если вы добавили новый компонент в провайдер и не
перезапустили dev‑сервер, список globs ещё старый. Перезапустите
`vite dev`. Итерация по классам уже выбранного компонента работает
без перезапуска.

## «У меня `@apply` в `styles.css` провайдера и он не разворачивается»

`cssFiles` подключаются как UnoCSS **preflights** — по умолчанию в обход
`transformer-directives`. Два решения: (1) `presetGranularNode({ expandDirectives: true })`
— пресет сам развернёт `@apply` / `@screen` / `theme()` во встраиваемом CSS;
либо (2) переложите CSS в SFC `<style src="./styles.css">` и включите
`transformerDirectives()` в `uno.config.ts`. См. рецепт в
[Темы и токены → `@apply` внутри per‑component `styles.css`](./themes-and-tokens.md#apply-внутри-per-component-stylescss).

## «Arbitrary values вроде `bg-[var(--card)]` не появляются»

Нужен `@unocss/preset-wind4` (или пресет, включающий arbitrary values (presetMini)).
`presetWind4()` должен быть в `presets` **перед** `presetGranularNode(...)`.

## «Cross‑provider `dependencies` падают при загрузке конфига»

`ProviderNotRegisteredError` означает, что ваш композитный провайдер
ссылается на `@feugene/other:DsIcon`, но `@feugene/other` не добавлен в
массив `providers` в `uno.config.ts` *приложения*. Добавьте. Также он
должен быть в `peerDependencies` композита.

## «Два провайдера имеют одинаковое имя компонента»

Имена уникальны **внутри провайдера**, а не глобально. Всегда используйте
квалифицированную форму (`providerId:Name`) или объектную
(`{ provider, names }`) — и в `options.components`, и в cross‑provider
`dependencies`.

## «TypeScript не видит `@feugene/unocss-preset-granular/contract`»

Убедитесь, что `@feugene/unocss-preset-granular` установлен как прямая
зависимость приложения/провайдера, и в `tsconfig.json` стоит
`moduleResolution: 'bundler'` (или `nodenext`) — TS тогда уважает
`package.json.exports`.

## «Dev в монорепо: `vite dev` видит старый код провайдера после пересборки»

Vite кеширует по URL модулей. Если провайдер линкован через workspace и
URL не менялся — поможет полная пересборка приложения или перезапуск
dev‑сервера. Для чисто CSS‑изменений обычно хватает сохранения файла —
watcher перегенерирует preflight.

## `granular doctor` — диагностика

В пресете есть CLI `granular` с подкомандой `doctor`, печатающей полный отчёт:
резолвнутые провайдеры, транзитивный граф выбранных компонентов
(deps → зависящие), блоки токенов тем по селекторам, **конфликты токенов**
между слоями (провайдер → компонент → app‑override), итоговые скан‑globs и
**отсутствующие директории `components/<Name>/`** (нарушения layout‑контракта).
Возвращает код `1` при любом нарушении — удобно для CI.

Укажите модуль, экспортирующий ваши granular‑опции:

```js
// granular.options.mjs
import provider from '@your/pkg/granular-provider/node'
export default { providers: [provider], components: 'all' }
```

```bash
npx granular doctor ./granular.options.mjs
```

Тот же отчёт доступен программно (например, из Vite‑плагина или скрипта):

```ts
import { granularDoctor, formatDoctorReport } from '@feugene/unocss-preset-granular/node'

const report = granularDoctor(options)   // структурированный DoctorReport
console.log(formatDoctorReport(report))  // человекочитаемый текст
if (!report.ok) process.exit(1)
```

## Куда копать глубже

- Тесты пресета
  (`packages/unocss-preset-granular/src/__tests__`) — living spec: если
  поведение неочевидно из доки, побеждают тесты.
- Чтобы посмотреть, что пресет зарезолвил, вызовите `defineGranular(options)`
  и прочитайте `.resolution()` (провайдеры, выбранные компоненты,
  `themes.tokenRegistry`) либо сдампите `.nodeCss()` /
  `getGranularThemeCss(options)`. Нарушения layout‑контракта дополнительно
  выводятся через `console.warn` (или бросаются при `scan: { strict: true }`).
- Для runtime‑логов задайте `DEBUG=granular:*` (или конкретный namespace —
  `granular:resolve` для зарезолвленного графа, `granular:scan` для скан‑дир).
  Вывод идёт в `stderr`; при незаданном `DEBUG` полностью выключен.
