# CLI `granular`

Пресет ставит один исполняемый файл — `granular`, объявленный как `bin` в
`@feugene/unocss-preset-granular`. У него пять подкоманд: `doctor` печатает то,
что пресет видит на самом деле (провайдеров, транзитивный граф компонентов,
блоки токенов тем, конфликты токенов, скан-globs и нарушения
layout-контракта), `explain` отвечает, почему в сборке оказался конкретный
компонент, `why-css` — какой компонент притащил в CSS конкретный класс,
`tokens` — какие токены тем компонент объявляет и потребляет, а
`prune` — какие объявления токенов в сборке никто не потребляет.

> 🇬🇧 English version: [`../en/cli.md`](../en/cli.md).

Запускается через пакетный менеджер, глобальная установка не нужна:

```bash
npx granular doctor  ./granular.options.mjs [--json] [--strict]
npx granular explain ./granular.options.mjs '@your/pkg:XButton' [--json]
npx granular why-css ./granular.options.mjs 'text-red-500' [--json]
npx granular tokens  ./granular.options.mjs 'XButton' [--deep] [--json]
npx granular prune   ./granular.options.mjs [--json] [--strict]
```

## Файл опций

Всем командам нужны granular-опции, а они обычно лежат внутри `uno.config.ts` —
файла, который CLI импортировать не может. Поэтому CLI принимает путь к
**отдельному модулю**, который их экспортирует.

Модуль должен быть импортируемым для Node (`.js` / `.mjs`) и экспортировать
опции под одним из трёх имён — `default`, `granularOptions` или `options`:

```js
// granular.options.mjs
import provider from '@your/pkg/granular-provider/node'

export default {
  providers: [provider],
  components: [{ provider: '@your/pkg', names: ['XButton'] }],
}
```

Всё остальное отваливается сразу: модуль без узнаваемого экспорта или опции
без массива `providers` дают ошибку использования, а не пустой отчёт.

Выносить опции в отдельный модуль стоит и без CLI: приложение тогда передаёт
**один и тот же объект** в `presetGranularNode()` и `granularContent()` — а
именно по его идентичности работают кэши пресета. См.
[Использование в приложениях](./usage-in-apps.md).

## `doctor` — как читать отчёт

Успешный прогон на приложении с одним компонентом:

```text
granular doctor
===============

Providers (1):
  • @feugene/simple-package — components: 7

Selected components (1, order = deps → dependents):
  • @feugene/simple-package:XTest1

Themes: [light] (source: core fallback)

Scan globs (1):
  • /abs/path/packages/simple-package/dist/components/XTest1/**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx,vue}

✓ OK — no layout-contract violations.
```

> **Примечание:** структура текстового отчёта стабильна, но для программного
> использования берите `--json` или структурный `DoctorReport`, а не
> разбирайте текст; см.
> [Программный доступ](#программный-доступ).

По разделам:

| Раздел | Что показывает |
|---|---|
| `Providers` | Все резолвнутые провайдеры, сколько компонентов каждый **объявляет** (не сколько выбрано), есть ли у него секция `theme` и вклад `unocss`. |
| `Selected components` | Транзитивное замыкание `options.components` в том порядке, в котором их эмитит пресет: **зависимости раньше зависящих** (post-order DFS). По каждому: `deps`, размер `safelist`, число `cssFiles`, `group`. |
| `Themes` | Список активных тем и в скобках — **откуда взялся список**: `themes.names`, ключи `themes.define`, `defaultThemes` провайдеров или фолбэк ядра. Дальше по строке на блок токенов: тема → селектор → число токенов. |
| `Token conflicts` | Печатается, только если непустой. См. ниже. |
| `Undeclared dependencies` | Печатается, только если непустой. См. ниже. |
| `Scan globs` | Ровно те globs, что уходят в UnoCSS `content.filesystem`. Если класс из исходника компонента не доезжает до CSS — смотреть надо сюда в первую очередь. |
| `Layout-contract problems` | Печатается, только если непустой. См. ниже. |
| `Diagnostics summary` | Все находки одним списком, с уровнем и машинным кодом. Печатается, только если непустой. |

### Конфликты токенов

Конфликт — это токен, значение которого пишет **больше одного слоя**. Это
законно и часто намеренно: цепочка приоритета —
`провайдер → компонент → app-override`, — но именно так токен молча перестаёт
делать то, что от него ждут. `doctor` перечисляет каждый такой токен с цепочкой
источников и победившим значением:

```text
Token conflicts (1) — the value is written by several layers:
  • [light] :root { --x-tokenized } ← component:XTokenized → app-override = #34d399
```

Источники идут в порядке применения и называются `provider:<id>`,
`component:<Name>`, `app-theme` (тема, объявленная приложением через
`themes.define`) или `app-override` (`themes.tokenOverrides`).

### Незаявленные зависимости

`component.dependencies` — это то, что провайдер **объявил**, а его сборка — то,
что он реально **отгрузил**. Ничто не держит их вместе: бандлер провайдера
`dependencies` не читает вовсе, поэтому расходятся они бесшумно. `doctor`
читает собранный код каждого выбранного компонента и сообщает о каждом импорте,
ведущем в директорию другого компонента и не покрытом объявленным графом:

```text
Undeclared dependencies (1) — the import is in dist, not in dependencies:
  • @your/pkg:XSidebar → @your/pkg:XButton ("../../XButton/chunks/XButton-DCi4.js" in chunks/XSidebar-Esxe.js)
```

Почему это важно: пресет сканирует `components/<Name>/` только у компонентов из
селекции. Приложение, выбравшее один `XSidebar`, никогда не заглянет в
директорию `XButton` и не получит его safelist — кнопка внутри сайдбара выйдет
без фона и без фокус-кольца. При этом не падает ничего: провайдер собирается,
типы целы, приложение собирается, а дефект видит только тот, кто взял ровно эту
селекцию.

Проверка сознательно **не смотрит на текущую селекцию** — в части ЦЕЛЕЙ.
Компонент-цель может оказаться выбранным по другой причине, и тогда CSS этой
сборки верен, но объявление всё равно врёт, и платит за это следующий
потребитель. Будь проверка привязана к селекции, самая частая конфигурация
(`components: 'all'`) не находила бы ничего никогда. А вот ИСТОЧНИКАМИ служат
только выбранные компоненты: автору провайдера доктора надо запускать с
`components: 'all'`, иначе проверено будет лишь замыкание его селекции.

Распознаются относительные импорты внутри пакета — включая те, что идут через
общий чанк (`chunks/`, `groups/<group>/shared/`): путь `A → shared → B` это
такое же ребро, как прямой импорт, и `source` в отчёте покажет файл, где импорт
реально записан. Межпакетные рёбра распознаются по bare-спецификаторам вида
`<providerId>/components/<ComponentName>` (или `<providerId>/<ComponentName>`);
это опирается на конвенцию «id провайдера = имя npm-пакета» и молча пропускает
ребро, если она не соблюдена.

### Чего проверка не видит

Разбор — регулярное выражение по тексту бандла, а не парсер, и `dist` читается
без исполнения. Отсюда список того, что заведомо остаётся за границей:

- **CJS-вывод.** `require()` не распознаётся, а `.cjs` не читается вовсе —
  чтобы отсутствие находок не выглядело проверкой. Granular-layout контракт
  предполагает ESM (`components/<Name>/index.js`).
- **Динамический `import()` с шаблонной строкой** (`` import(`../${n}.js`) ``) —
  цель неизвестна до рантайма.
- **Импорт-как-данные.** Спецификатор внутри строкового литерала будет
  засчитан как импорт. На реальных бандлах не встречается, но возможен.
- **Компоненты вне селекции** как источники — см. `components: 'all'` выше.

И обратное, чего проверка не умеет отличить: импорт **константы, типа или
утилиты** из чужой директории выглядит как импорт компонента. Если найденное
ребро ничего не рендерит — это ложное срабатывание, а не пропущенная
зависимость: объявив её, вы притащите всем своим потребителям весь CSS и
safelist донора.

Уровень — `warn`, а не `error`, по одной причине: находка **эвристическая**
(см. список выше), а эвристике не место в безусловном отказе. Смягчением это не
является: `--strict`, который здесь же рекомендуется для CI, роняет `warn` ровно
так же, как `error`. Разница только в поведении по умолчанию — и в том, что
находка меняет `clean`, а не `ok`.

### Нарушения layout-контракта

Сканирование компонентов требует, чтобы у каждого выбранного компонента была
своя директория `components/<Name>/` в сборке провайдера. Если её нет, классы
компонента не извлекаются из исходника и молча исчезают из CSS — сборка при
этом зелёная. `doctor` — та проверка, которая превращает это в отказ:

```text
Scan globs (0):

⚠ Layout-contract problems (1):
  • @feugene/simple-package:XTest1 — directory is missing (/abs/path/components/XTest1/)

✗ Layout-contract violations found: 1.
```

Различаются три причины — `directory is missing`, `index.js is missing`
(директория без entry) и `invalid packageBaseUrl` (база провайдера не
резолвится, обычно это ловушка с `data:`-URL). Лечится почти всегда рецептом
`chunkFileNames` из [Разработки провайдеров](./authoring-providers.md).

### Уровни диагностики и `--strict`

Все находки отчёта сводятся в плоский список `diagnostics` с двумя уровнями.
Критерий один: **обязано ли это сломать сборку**.

| Код | Уровень | Что означает |
|---|---|---|
| `layout-contract` | `error` | Компонент не попал в скан — его классы молча исчезают из CSS. |
| `theme-warning` | `warn` | Предупреждение резолва тем: `defaultThemes` без источника, частичная тема, оборванный `extends`, несколько тем по умолчанию. |
| `token-conflict` | `warn` | Токен задаётся несколькими слоями. |
| `unused-provider` | `warn` | Провайдер не дал сборке ничего: ни выбранных компонентов, ни `theme`, ни `unocss`. |
| `undeclared-dependency` | `warn` | Собранный компонент импортирует другой, не объявив его — у того, кто выберет его отдельно, классы исчезнут. |
| `token-prefix` | `warn` | Ключ токена объявлен **с** префиксом `--` — генератор дописывает его сам, в CSS уедет валидный, но бесполезный `----x`, и тема молча останется без значения. |
| `token-undefined` | `warn` | Компонент потребляет токен, которого не задаёт ни один granular-слой. Эвристика ровно в том же смысле, что `undeclared-dependency`: токен может прийти извне granular. |

`ok` в отчёте — это «нет ни одной `error`», `clean` — «нет вообще ничего».
По умолчанию `doctor` падает только на `error`; `--strict` роняет его и на
предупреждениях:

```text
Diagnostics summary (errors: 0, warnings: 2):
  ⚠ [theme-warning] p:night — p lists "night" in defaultThemes but does not supply it (neither themes[name] nor tokenDefinitions[name])
  ⚠ [token-conflict] light:primary — :root { --primary } is written by several layers (provider:p → app-override), final value: red

✓ OK — no layout-contract violations; warnings: 2 (they only fail with --strict).
```

### `--json`

Флаг есть у всех четырёх команд: он печатает тот же отчёт структурой, чтобы его
не пришлось разбирать из текста. Форма — ровно `DoctorReport` /
`ExplainReport` / `WhyCssReport` / `TokensReport` из `/node`:

```json
{
  "providers": [{ "id": "@your/pkg", "components": 7, "hasTheme": false, "hasUnocss": false }],
  "diagnostics": [{ "level": "warn", "code": "unused-provider", "subject": "@other/pkg", "message": "…" }],
  "ok": true,
  "clean": false
}
```

## `explain` — почему компонент в сборке

Отвечает на вопрос «откуда он здесь взялся и что приносит». Имя компонента
можно писать полностью (`providerId:Name`) или коротко — короткая форма
принимается, пока она однозначна:

```bash
npx granular explain ./granular.options.mjs XCard
```

```text
granular explain @your/pkg:XBase
================================

Status: in the build — pulled in as a dependency

Chain from the selection root:
  @your/pkg:XCard → @your/pkg:XBase

Dependencies (0):

Required by (1):
  • @your/pkg:XCard

Contributes to the build:
  safelist (1): base-cls
  cssFiles (1):
    • file:///abs/path/base.css (asset: base.css)
  tokens (1 theme(s)):
    • [light] :root
        --x-color: #000 (overridden → #fff)

Scan directories (1):
  • /abs/path/packages/pkg/dist/components/XBase
```

Что здесь важно:

- **Цепочка (`Chain`)** — кратчайший путь от корня селекции. Если компонент
  перечислен в `options.components` напрямую, цепочка состоит из него одного.
- **`overridden → …`** у токена значит, что значение компонента переписал слой
  выше (другой компонент, `themes.define` или `tokenOverrides`).
- **`deduplicated into …`** у `cssFiles` значит, что тот же URL раньше объявил
  другой компонент, и файл эмитится от его имени (дедуп идёт по URL).
- **Пустые скан-директории** — тот же layout-контракт, что и в `doctor`;
  причина печатается отдельной строкой.

Компонент вне селекции — это валидный ответ (`NOT in the build`) и код `0`.
Код `1` даёт только неизвестное имя: тогда команда печатает список известных.

## `why-css` — кто притащил класс

Обратный вопрос: класс в CSS есть, но непонятно, откуда. Команда проверяет все
три канала, которыми класс может туда попасть:

```bash
npx granular why-css ./granular.options.mjs x-sp-test
```

```text
granular why-css x-sp-test
==========================

Sources (1):
  component source in content.filesystem:
    • @feugene/simple-package:XTest1 — dist/components/XTest1/chunks/XTest1-86x1RTRg.js

Scanned: 0 CSS file(s), 2 source file(s) in 1 director(ies).
```

- `component safelist` — класс объявлен в `safelist`, утилита эмитится всегда,
  даже если класса нет ни в одном исходнике;
- `selector in a component CSS file` — класс приезжает готовым правилом из
  `cssFiles` (экранирование вида `.hover\:bg-red` учитывается, искать надо по
  исходному имени класса);
- `component source in content.filesystem` — класс найден в файлах, которые
  видит extractor; набор расширений тот же, что у скана (с учётом
  `scan.extensions` / `scan.replaceExtensions`).

Ничего не найдено — код `1`. Это не обязательно ошибка: класс мог родиться из
`rules`/`shortcuts` самого UnoCSS или провайдера, прийти из base/tokens/CSS
темы либо из кода приложения — эти источники команде не видны. Зато как ассерт
в CI («этот класс больше не приходит из пакета») код выхода работает.

## `tokens` — какие токены нужны компоненту

`explain` отвечает, откуда компонент взялся; `tokens` — что ему нужно, чтобы
выглядеть правильно. Команда отделяет **собственные** токены компонента от
**общих**, которые он лишь потребляет, показывает полную цепочку слоёв за каждым
значением и называет токены, которых не задаёт никто.

```bash
npx granular tokens ./granular.options.mjs XTestStyled [--deep] [--json]
```

```text
granular tokens @feugene/simple-package:XTestStyled
===================================================

Status: in the build; scope: this component only (--deep adds sub-components)

Declares (0): —

Uses (4):
  from the application (2):
    • --brd  [safelist]
        [light] :root  app-override #02f8fa
        also used by (1): @feugene/simple-package:XTest1
    • --card-fg  [safelist]
        [light] :root  app-override #af172a
  not defined by any granular layer (2):
    ⚠ --card  [safelist] (no fallback)
    ⚠ --ds-radius-lg  [safelist] (no fallback)

Scanned: 6 safelist entr(ies), 0 CSS file(s), 13 source file(s) in 8 director(ies).
```

### Свои токены против общих

`Uses` группируется по **происхождению** — нижнему слою цепочки токена, — и сам
порядок групп есть ответ на вопрос «где мои, а где общие»:

| Группа | Происхождение | Что означает |
|---|---|---|
| declared by this component | `own` | Компонент публикует токен через `tokenDefinitions` и сам его потребляет. |
| declared by another component | `component` | Неявная связь через токен: публикует его кто-то другой. |
| from the provider — design-system tokens | `provider` | `provider.theme.tokenDefinitions` либо его инлайнимый `tokensCssUrl` / `baseCssUrl` / файл темы — общая палитра. |
| from the application | `app` | `themes.define`, `themes.tokenOverrides` либо файл, подменённый через `themes.tokensFile` / `baseFile` / `themeFiles`. |
| not defined by any granular layer | `none` | Не задаёт никто. См. оговорку ниже. |

`also used by` перечисляет **другие выбранные компоненты**, потребляющие тот же
токен, — то есть кого ещё заденет его правка. Считается всегда: обход всё равно
идёт по всем выбранным компонентам за один проход, поэтому дополнительная
стоимость нулевая.

### Значения по слоям

Каждое значение печатается цепочкой, породившей его, в порядке применения —
поэтому видно не только *какое* значение, но и *кто* его задал:

| Цепочка | Как читать |
|---|---|
| `provider:@your/pkg #ccc → app-override #02f8fa` | дефолт провайдера, перебитый приложением |
| `component:XTokenized red` | один слой — собственное значение компонента |
| `provider '@your/pkg' 6px` (без стрелок) | объявлено в инлайнимом CSS-файле, а не структурным слоем |
| `app-override 8px (dropped by strictTokens) — not in the CSS` | override написан, но `strictTokens` его отбросил |

Цепочка приходит из той же функции, из которой эмитится CSS, поэтому показать
значение, которого сборка не производит, она не может.

### `--deep` — токены под-компонентов

Без флага отчёт покрывает только сам компонент. `--deep` добавляет его
транзитивные `dependencies` и отвечает на вопрос «что нужно компоненту
*вместе* со всем, что он тянет». Происхождение всегда считается
**относительно цели**: токен, опубликованный под-компонентом, попадает в группу
`declared by another component` — ровно то, ради чего флаг и нужен.

Части, лежащие внутри директории самого компонента (`parts/`), зависимостями не
являются и никогда не были — это его собственный код, поэтому их токены
остаются `own`.

### Чего проверка не видит

Потребление ищется тремя каналами — `safelist` (чистые данные резолюции),
`component-css` (объявленные `cssFiles`) и `source-scan` (исходники компонента
в `content.filesystem`). Разбор текстовый, отсюда границы:

Токен, объявленный в инлайнимом CSS (`tokensCssUrl`, `baseCssUrl`, файл темы),
несёт значение, но не цепочку слоёв: `tokenOverrides` до него не дотянется, пока
провайдер не поднимет его через `tokenDefinitionsFromCss`. Такое значение
печатается отдельной строкой, без стрелок.

- **Токены в общих чанках вне директории компонента.** Если компонент объявил
  свои классы в `safelist`, они находятся там; если не объявил — их не видит и
  extractor UnoCSS, так что пропуск совпадает с фактическим отсутствием CSS.
- **Динамически собранные имена** (`` var(--${name}) ``) — неизвестны до рантайма.
- **`var(--x)` внутри строки-данных или комментария** засчитается как потребление.
- **`.cjs`** не читается — ровно как в проверке зависимостей.

## `prune` — что можно не эмитить

`tokens` отвечает на покомпонентный вопрос. `prune` — на вопрос про сборку
целиком: какие объявления токенов уезжают в CSS, не будучи никем потреблены.

Команда **никогда не меняет эмиссию**. Она читает конфигурацию и печатает
план; саму обрезку включает `pruneTokens.mode` в опциях пресета — см.
[Темы и токены](./themes-and-tokens.md).

```bash
npx granular prune ./granular.options.mjs [--json] [--strict]
```

```text
granular prune
==============

Mode: off
  (trimming is disabled — everything below is what it WOULD do;
   enable it with pruneTokens.mode in the preset options)
Providers: @feugene/heavy-package
Themes: light, dark

Files (4):
  • provider '@feugene/heavy-package' — theme/tokens.css — 52 declared, 19 kept, 33 removed   3.4 kB → 2.4 kB
  • provider '@feugene/heavy-package' — theme/base.css — not pruned (base: rules, not declarations)
  • provider '@feugene/heavy-package' — theme/light.css [light] — 64 declared, 29 kept, 35 removed   3.8 kB → 2.6 kB

Kept (49):
  consumed by a selected component (42):
    • --xh-accent
  used by rules of the inlined CSS (6):
    • --xh-bg
  referenced by another kept token (1):
    • --xh-fg-boost  ← --xh-elevated-fg

Removed (68): --xh-amber-100 --xh-amber-300 …

Total: 11.6 kB → 8.3 kB (-29%).
Application sources: not configured — the preset did not read a single file of this application.
```

### Как читать группы «Kept»

Группа — это сильнейшая причина, по которой токен уцелел, в порядке:
потребляется компонентом, используется CSS-файлом компонента, используется
правилами инлайнимого CSS, найден в исходниках приложения, в него целится
override, объявлен структурным слоем, сохранён шаблоном, на него ссылается
другой сохранённый токен.

`referenced by another kept token` — это транзитивное замыкание: производная
роль вида `color-mix(…, var(--accent), …)` держит `--accent` живым, даже если
напрямую его никто не поминает.

### Последняя строка не декоративна

`Application sources: not configured` означает, что пресет не прочитал ни
одного файла вашего приложения. Он видит компоненты провайдера и не видит вашу
разметку, поэтому `bg-[var(--brand)]` в `App.vue` для него не существует.
Переводить `mode` в `'on'` в этом состоянии — самый частый способ потерять
токен молча.

### Шаблон, не совпавший ни с чем

```text
⚠ Patterns matching nothing declared (1):
    • @feugene/granularity:GrPopover → gr-z-dropdow
```

Опечатка в `keep` / `keepPrefixes` либо строка `dynamicTokens`, оставшаяся
после того, как компонент перестал собирать имя в рантайме. Само по себе
ничего не ломает — потому и гниёт незамеченным.

Две вещи находкой намеренно НЕ считаются: шаблон, совпавший хоть с одним
токеном, живой даже когда тот же токен покрывает и соседний шаблон; и
объявление компонента вне этой селекции — оно просто не применилось к сборке.

### Удалён, но имя собирается в рантайме

```text
⚠ Removed, but the name appears as a literal outside the scanned directories (2):
    • --gr-z-dropdown  chunks/overlayStack-DH4Z7am1.js
    • --gr-z-modal     chunks/overlayStack-DH4Z7am1.js
```

Единственный случай, где обрезка ломается молча: общий модуль собирает `var()`
в рантайме, бандлер вынес его в чанк вне `components/<Name>/`, и ни один
статический канал туда не дотягивается. Лечится `dynamicTokens` у компонента,
который этот токен читает.

Шума не возникает благодаря двум условиям. Файл обязан ТУТ ЖЕ собирать
`var()` — одного имени мало. И токен, объявленный в `dynamicTokens` ЛЮБЫМ
компонентом провайдера, находкой не считается никогда: он объявлен, просто не
попал в эту селекцию.

Одного имени для находки мало — файл обязан ТУТ ЖЕ собирать `var()`. Без этого
условия находкой становится каждый удаляемый токен: у дизайн-системы обычно
есть TS-зеркало реестра, где каждое имя лежит строкой. Измерено на реальном
пакете: 195 находок из 195 удаляемых до условия, 2 после.

### `--strict`

Выходит с кодом 1, если удалять есть что. Годится гейтом вида «фундамент уже
вычищен»: в репозитории с включённой обрезкой растущий список удаляемого
означает, что компонент перестал потреблять токен, то есть регрессию стиля,
а не победу.

## Коды выхода

| Вызов | Вывод | Код |
|---|---|---|
| `granular doctor <file>` — нарушений нет | отчёт в stdout | `0` |
| `granular doctor <file>` — нарушения найдены | отчёт в stdout | `1` |
| `granular doctor <file> --strict` — есть предупреждения | отчёт в stdout | `1` |
| `granular explain <file> <component>` — компонент известен | отчёт в stdout | `0` |
| `granular explain <file> <component>` — имя неизвестно или неоднозначно | отчёт со списком известных | `1` |
| `granular why-css <file> <class>` — источник найден | отчёт в stdout | `0` |
| `granular why-css <file> <class>` — источников нет | отчёт в stdout | `1` |
| `granular tokens <file> <component>` — компонент известен | отчёт в stdout | `0` |
| `granular tokens <file> <component>` — имя неизвестно или неоднозначно | отчёт со списком известных | `1` |
| `granular prune <file>` — план напечатан | отчёт в stdout | `0` |
| `granular prune <file> --strict` — есть что удалять | отчёт в stdout | `1` |
| любая команда — файла нет, не импортируется или не экспортирует опции | сообщение в stderr | `1` |
| `granular help` / `--help` / `-h` | справка в stdout | `0` |
| `granular` без аргументов | справка в stdout | `1` |
| `granular <что-угодно-ещё>` | справка в stderr | `1` |

Раз нарушение — это код выхода, а не просто предупреждение, `doctor` кладётся
прямо в CI, где ловит провайдера, опубликованного с плоским `dist/`, до того
как сломанный CSS доедет до кого-нибудь:

```bash
- run: npx granular doctor ./granular.options.mjs --strict
```

## Программный доступ

Те же отчёты доступны из node-входа — это лучший вариант внутри Vite-плагина,
теста или скрипта, который хочет что-то сделать с результатом, а не показать
его:

```ts
import {
  formatDoctorReport,
  granularDoctor,
  granularExplain,
  granularTokens,
  granularWhyCss,
} from '@feugene/unocss-preset-granular/node'
import granularOptions from './granular.options.mjs'

const report = granularDoctor(granularOptions) // структурный DoctorReport
console.log(formatDoctorReport(report)) // текст, показанный выше

if (!report.ok)
  throw new Error(`нарушен layout-контракт: ${report.scan.missing.length}`)

granularExplain(granularOptions, '@your/pkg:XButton') // ExplainReport
await granularWhyCss(granularOptions, 'text-red-500') // WhyCssReport (читает файлы)
granularTokens(granularOptions, '@your/pkg:XButton', 'deep') // TokensReport
```

`granularDoctor` и `granularExplain` резолвят через тот же мемоизированный
конвейер, что и сам пресет, поэтому передача объекта, который уже держит
`uno.config.ts`, не стоит ничего сверх проверок директорий — и гарантирует, что
отчёт описывает ровно ту сборку, которая уедет в прод, а не вторую,
резолвнутую отдельно.

Типы (экспортируются из `/node`): `DoctorReport` — `providers`, `components`,
`themes` (`names`, `namesSource`, `blocks`, `warnings`), `tokenConflicts`,
`undefinedTokens`, `undeclaredDependencies`, `scan` (`globs`, `dirs`, `missing`), `diagnostics`
и булевы `ok` / `clean`;
`ExplainReport` — `reason`, `chain`, `requiredBy`, `safelist`, `cssFiles`,
`tokens`, `scanDirs`; `WhyCssReport` — `hits`, `scanned`, `found`;
`TokensReport` — `scope`, `components`, `declares`, `uses`, `scanned`,
`sourceScanActive`, `undefinedCount`.

### Стабильность отчётов

Отчёты **расширяются в минорных версиях**: новые поля и новые коды диагностик
добавляются без поднятия major. Практические следствия для того, кто читает их
из кода:

- `DoctorDiagnosticCode` — **открытый** union. Не пишите по нему исчерпывающий
  `switch` с `never`-веткой: он перестанет компилироваться на апгрейде.
  Обрабатывайте известные коды, остальные — общей веткой.
- `TokenUsageVia` и `TokenKeepReason` открыты в том же смысле: каналы и
  причины сохранения добавляются по мере того, как анализ учится видеть больше.
- Поля отчёта **обязательные**. Если вы конструируете `DoctorReport` вручную
  (мок в тестах), добавление поля сломает компиляцию — берите отчёт из
  `granularDoctor`, а не собирайте его руками.
- Новый код уровня `warn` **меняет `clean`, но не `ok`**. CI на
  `doctor --strict` может покраснеть после минорного апгрейда — это ожидаемо и
  означает настоящую находку, а не поломку API.

`GRANULAR_CONTRACT_VERSION` к этому отношения не имеет: он версионирует форму
`GranularProvider`, а не отчёты CLI.

## Смотри также

- [Диагностика и рецепты](./troubleshooting.md) — список «от симптома»;
  большинство пунктов заканчивается разделом про `doctor`.
- [Сканирование компонентов](./component-scanning.md) — что означают
  скан-globs и как они вычисляются.
- [Темы и токены](./themes-and-tokens.md) — цепочка приоритета, стоящая за
  отчётом о конфликтах токенов.
