---
paths:
  - "packages/unocss-preset-granular/**"
---

> **Применяется когда:** меняешь ядро пресета, контракт, node-слой, doctor, CLI или его тесты.
> **Не нужно:** при работе с провайдерами (`.claude/rules/provider-packages.md`),
> приложениями (`apps.md`) и документацией (`docs.md`).
> **Смежное:** `.claude/docs/workspace.md` (команды, карта API).

## Слои и что в каком можно

| Каталог | Роль | `node:`-импорты |
|---|---|---|
| `src/contract/` | публичный контракт + `define*`-хелперы | запрещены |
| `src/core/` | резолв графа, темы, ошибки, дедуп | запрещены |
| `src/preset.ts` | browser-пресет | запрещены |
| `src/fs/`, `src/node-utils/`, `src/preset.node.ts`, `src/doctor.ts`, `src/cli.ts`, `src/bin.ts` | node-слой | разрешены |
| `src/vite.ts`, `src/vite-utils/` | build-слой провайдера: чистые хелперы имён + `granularCssAssetsPlugin` (ходит в FS) | разрешены — entry исполняется только в `vite.config.ts`; импорт `/vite` в browser-код запрещён так же, как `/node` |
| `src/runtime.ts`, `src/runtime/` | рантайм-слой (переключение тем в браузере) | запрещены |
| `src/codegen.ts`, `src/codegen/` | оснастка провайдера: генерация его реестров компонентов из `src/components/` | разрешены — entry зовут из скриптов и тестов пакета, не из кода |

`src/index.ts` тянет `contract` + `preset`; `src/node.ts` реэкспортирует `index` и
добавляет node-слой. Любой `node:`-импорт, доехавший до `src/index.ts`, ломает
браузерный экспорт. Проверка — по собранному бандлу, не по исходникам:

```bash
grep -o 'node:[a-z/]*' packages/unocss-preset-granular/dist/index.js   # должно быть пусто
```

## Инварианты, которые нельзя нарушить молча

- **Контракт версионирован.** `GRANULAR_CONTRACT_VERSION = 1`. Ломающее изменение
  формы `GranularProvider`/`GranularComponentDescriptor` требует поднятия версии и
  политики поддержки — иначе чужие провайдеры сломаются без внятной ошибки.
  Добавление опционального поля обратно совместимо.
- **Семь кэшей завязаны на идентичность `options`** (`WeakMap`): материализация
  `tokenDefinitionsRef` (`materializeRefs.ts`), резолюция графа (`preset.ts`),
  инспекция скан-директорий и готовый `content` (`preset.node.ts`),
  резолв путей к CSS компонентов (по идентичности резолюции), индекс потребления
  токенов (`fs/tokenUsage.ts`), скан исходников приложения для обрезки
  (`node-utils/tokenPrune.ts`). ПЛАН обрезки при этом НЕ кэшируется намеренно:
  он зависит от текста инлайнимых файлов, а `readCss` кэширован по mtime —
  при правке `tokens.css` в dev текст меняется, идентичность опций нет, и кэш
  плана протух бы молча. Не мутируй `options`
  после первого резолва и не пересоздавай объект между `presetGranularNode(opts)` и
  `granularContent(opts)`: граф и весь обход FS посчитаются заново, а части могут
  разъехаться. Замер на `components: 'all'`: 200 вызовов `granularContent` на одном
  объекте — 1 мс, на новом каждый раз — 30 мс.
- **Логгеры `createDebug` разбирают `DEBUG` один раз** — при создании. Выключенный
  логгер это no-op; менять `process.env.DEBUG` в рантайме уже созданные логгеры не
  видят (живая проверка — `isDebugEnabled`).
- **Порядок компонентов — post-order DFS** (зависимости раньше зависящих). На нём
  держится приоритет мержа токенов: провайдеры → компоненты → app-overrides.
- **Ошибки — типизированные классы из `src/core/errors.ts`**, с `providerId`/
  `componentName`/`referencedBy` в полях, а не только в тексте. Новый класс отказа —
  новый класс ошибки, не `throw new Error`.
- **Форма провайдера валидируется в `expandProviders`** (`InvalidProviderError`):
  пустой `id`, `packageBaseUrl` не-URL или без завершающего `/`, рассинхрон длин
  `cssFiles`/`cssFileAssetNames`. Новую проверку добавляй туда же, а не в FS-слой:
  там она превратится в `console.warn` и молчаливый пропуск.
- **Чтение CSS оборачивается в `GranularCssReadError`** с провайдером, секцией и
  именем темы/компонента; сырой `ENOENT` — в `cause`.
- **Токены в `tokens` — без префикса `--`**; его дописывает `serializeThemeBlock`.
- **`scanCssDeclarations` (`node-utils/cssDeclarations.ts`) отвечает на ДРУГОЙ
  вопрос, чем `parseCssCustomPropertyBlocksSync`.** Та выражает файл набором
  `{ selector, tokens }` и потому обязана пропускать невыразимое — блоки внутри
  at-rules и вложенные. Эта отвечает «какие байты объявляют токен» и обязана
  быть полной: `@supports`-фолбэки производных ролей живут именно там, и
  обрезка, их не видящая, оставит в файле объявление удалённого токена.
  Не подменяй одну другой.
- **Значения токенов считает ОДНА функция** — `collectTokenLayers` (`core/tokenLayers.ts`).
  Из неё сериализуется CSS и из неё же читают `doctor`, `explain`, `granular tokens`
  и манифест тем. Раньше ответов было три, и два врали: `explain` и манифест не
  видели `tokenOverrides`, `doctor` не видел `strictTokens`. Не считай значение по
  `themes.tokenRegistry` напрямую — четвёртый слой (`tokenOverrides`) в реестр не входит.
- **Node-слой резолвит через `resolveGranularNode(options)`**, а не через
  `resolvePresetGranular(options)` напрямую: первая разворачивает
  `tokenDefinitionsRef` и возвращает стабильный по ссылке производный объект опций.
  Прямой вызов даст ВТОРУЮ резолюцию — с нераскрытыми ссылками и мимо всех кэшей.
- **Манифест тем строится из ТОЙ ЖЕ резолюции, что и CSS** (`getGranularThemeManifest`
  → `resolveGranularNode`). Не собирай его из отдельного прохода по провайдерам:
  разъехавшийся селектор ломает переключение молча — ни ошибки, ни предупреждения.

## Тесты

`src/__tests__/*.test.ts`, запуск — `yarn test:granular` из корня.
Тесты объявлены в `docs/en/troubleshooting.md` авторитетным описанием поведения,
поэтому изменение поведения без правки/добавления теста — это молчаливое расхождение
со спецификацией.

В `vitest.config.ts` заданы **пороги покрытия** (statements/lines 90, branches 85,
functions 90) — `--coverage` упадёт, если новый код придёт без тестов.
`src/bin.ts` исключён из покрытия: это 10 строк-обёртка, исполняемая на импорте;
вся логика CLI — в `src/cli.ts` (100%). Меняешь поведение CLI — правь `cli.ts`,
а не `bin.ts`.

## Проверка перед сдачей

```bash
yarn test:granular                                          # 539 тестов
cd packages/unocss-preset-granular && npx tsc -p tsconfig.json --noEmit && yarn lint
```

Все три должны быть зелёными — предсуществующих ошибок больше нет.