# Команды и карта репозитория

> **Применяется когда:** нужна точная команда, карта каталогов или справка по
> публичному API пресета.
> **Не нужно:** когда что-то уже сломалось необъяснимым образом — это `gotchas.md`.
> **Смежное:** `.claude/docs/gotchas.md`, `.claude/docs/git-and-release.md`.

Пакетный менеджер — **Yarn 1**. Все команды ниже проверены запуском из корня
репозитория, если не сказано иное.

## Из корня

| Команда | Что делает |
|---|---|
| `yarn test:granular` | тесты пресета (36 файлов / 539 тестов) |
| `yarn test:scripts` | тесты чистых функций измерителя (`vitest.config.mjs` в корне) |
| `yarn build:granular` | сборка только пресета |
| `yarn build:unocss-mini-extra-rules` | сборка пакета доп-правил |
| `yarn build:packages` | пресет → доп-правила → `simple-package` → `extra-simple-package` → `heavy-package` |
| `yarn build:apps` | сборка `app-1..6` и стендов `bench-*` (требует уже собранных пакетов) |
| `yarn build:bench` | только три стенда замера |
| `yarn build:all` | `build:packages` + `build:apps` — основная проверка целостности |
| `yarn sizes` | отчёт о весе: `bench-one` против `bench-zero`, `bench-pruned` против `bench-one` |
| `yarn sizes:check` | строгая сверка бюджета стендов с их `expected-budget.mjs` |
| `yarn test` | алиас `test:granular` |

`yarn build:all` — единственная команда, которая проверяет контракт целиком.
Выполняется за секунды.

## Внутри `packages/unocss-preset-granular`

| Команда | Что делает |
|---|---|
| `npx vitest run --config vitest.config.ts` | тесты |
| `npx vitest run --config vitest.config.ts --coverage` | покрытие (v8) |
| `npx tsc -p tsconfig.json --noEmit` | typecheck, включая тесты |
| `npx vite build && npx tsc -p tsconfig.build.json` | сборка (`build`) |
| `npx --yes publint@latest --pack npm` | валидация метаданных пакета |

Скрипта `typecheck` у пакета нет — гоняй `npx tsc -p tsconfig.json --noEmit`
руками (у остальных пакетов есть: `yarn workspace <name> typecheck` через
`vue-tsc`). `yarn lint` работает и должен быть зелёным.

**TypeScript в репозитории зафиксирован на 6.x** (`resolutions` в корневом
`package.json`): TypeScript 7 — это нативный `tsgo`, его npm-пакет не отдаёт
JS compiler API, из-за чего `@typescript-eslint` падает при загрузке. Снимешь
`resolutions` — вернётся неработающий lint.

## Отладочные переменные

```bash
DEBUG=granular:*        # оба namespace, вывод в stderr
DEBUG=granular:resolve  # что зарезолвило ядро: провайдеры, компоненты, темы
DEBUG=granular:scan     # директории авто-сканирования
```

CLI-диагностика — четыре команды, все принимают `--json`:
`granular doctor <opts>` (провайдеры, граф компонентов, блоки и конфликты токенов,
скан-globs, нарушения layout-контракта; выход `1` при `error`, с `--strict` — и при
`warn`), `granular explain <opts> <providerId:Name>` (почему компонент в сборке:
цепочка от корня селекции, обратные зависимости, вклад в safelist/CSS/токены) и
`granular why-css <opts> <class>` (каким каналом класс попал в CSS) и
`granular tokens <opts> <providerId:Name> [--deep]` (какие токены компонент
объявляет и потребляет, сгруппированные по происхождению — свои / общие / ничьи,
с полной цепочкой слоёв за каждым значением). Программный доступ —
`granularDoctor` / `granularExplain` / `granularWhyCss` / `granularTokens` и
парные `format*Report` из `/node`.

## Карта репозитория

```
packages/unocss-preset-granular/   пресет; всё остальное — его потребители
  src/contract/                    публичный контракт, define*-хелперы
  src/core/                        резолв графа, темы, реестр, ошибки
  src/fs/, src/node-utils/         node-слой: чтение CSS, скан-директории, парсер токенов
  src/preset.ts / preset.node.ts   browser- и node-пресеты
  src/doctor.ts                    диагностика (granularDoctor / formatDoctorReport)
  src/explain.ts, src/why-css.ts   granular explain / why-css (отчёты + форматтеры)
  src/tokens.ts                    granular tokens (токены компонента по происхождению)
  src/core/tokenLayers.ts          ЕДИНЫЙ источник значений токенов: слои → эффективное
  src/fs/tokenUsage.ts             сканер `var(--…)`: safelist / cssFiles / исходники
  src/cli.ts, src/bin.ts           CLI `granular` (логика / точка входа)
  src/vite.ts, src/vite-utils/     granularChunkFileNames() / granularAssetFileNames() /
                                   granularCssAssetsPlugin()
  src/runtime.ts, src/runtime/     createThemeController() — переключение тем в браузере
  src/node-utils/themeManifest.ts  манифест тем + Vite-плагин virtual:granular-themes
packages/simple-package/           референсный провайдер (7 компонентов, группа groupA)
packages/extra-simple-package/     провайдер с кросс-провайдерными зависимостями
packages/unocss-mini-extra-rules/  доп-правила поверх preset-mini, к granular не привязан
apps/app-1..6/                     демо-приложения = интеграционные тесты
docs/{en,ru}/                      документация, парные файлы
```

## Публичный API пресета

**`@feugene/unocss-preset-granular`** (browser) — `presetGranular`,
`resolvePresetGranular`, `expandProviders`, `resolveThemes`, классы ошибок, типы
контракта.

**`/node`** — надмножество корневого экспорта плюс: `defineGranular` (рекомендуемый
билдер, отдаёт `preset()`/`content()`/`resolution()`/`nodeCss()`),
`presetGranularNode`, `granularContent`, `resolveGranularFilesystemGlobs`,
`getGranularNodeCss` / `getGranularThemeCss` / `getGranularComponentCss`,
`granularDoctor`, `formatDoctorReport`, `granularTokens`, `formatTokensReport`,
`tokenDefinitionsFromCss[Sync]`,
`parseCssCustomPropertyBlocks[Sync]`, `readCss`, `clearCssCache`.

**`/contract`** — `defineGranularProvider`, `defineGranularComponent`,
`GRANULAR_CONTRACT_VERSION` и типы. Единственный экспорт, который импортируют
провайдеры в браузерном коде.

**`/vite`** — `granularChunkFileNames()`, `granularAssetFileNames()`,
`granularCssAssetsPlugin()`. Используется в `vite.config.ts` пакета-провайдера.
Первые две — чистые функции. Плагин ходит в FS (`node:fs/promises`): он кладёт
в `dist` тот CSS, который конфиг задекларировал строкой (`tokenDefinitionsRef`,
`cssFiles`), а бандлер поэтому не эмитит. Vite/rolldown/UnoCSS не импортирует
ни один из трёх — формы плагина и конфига типизированы структурно.