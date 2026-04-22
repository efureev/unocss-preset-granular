# `@feugene/unocss-preset-granular` — ТЗ и план реализации

> Статус: **утверждено**
> Автор: Jack
> Дата: 2026-04-19

## 0. TL;DR

Выносим `presetGranularityNode` и связанный node‑рантайм (резолв CSS‑файлов, preflights компонентов/тем,
safelist‑агрегация) из `@feugene/granularity` в отдельный **агрегатор‑пакет для UnoCSS** —
`@feugene/unocss-preset-granular`.

Пакет не знает ни про один конкретный UI‑пакет. Он знает только про **универсальный публичный контракт провайдера** (
`GranularProvider`). Пакеты‑доноры (`@feugene/granularity`, `@feugene/extra-granularity`, любые сторонние) экспортируют
этот контракт и подключаются в пресет декларативно. В `uno.config.ts` приложение перечисляет:

- какие провайдеры участвуют,
- какие компоненты из каждого провайдера нужны,
- какие темы (light/dark/both) подключать.

На выходе — единый, дедуплицированный набор `safelist` + `preflights` только для того, что реально используется или явно
запрошено.

---

## 1. Цели

- Отдельная независимая либа, реализующая UnoCSS‑preset (browser + node варианты).
- Универсальный контракт `GranularProvider` для пакетов‑доноров.
- Поддержка тем (light/dark/both) на уровне ядра либы с возможностью вклада от провайдеров.
- Поддержка кастомных `rules`/`variants` от провайдеров (через публичный контракт).
- Итоговый CSS — без дубликатов, без лишних стилей.
- Совместимо с `@unocss/preset-wind4` (встроенные rules/variants из старого `presetGranularity` уходят в pакет
  `@feugene/granularity` в виде его `unocss`‑contribution — см. §6).

---

## 2. Нефункциональные требования

- ESM‑only, Node ≥ 22, TypeScript strict.
- `peerDependencies`: `unocss` (или `@unocss/core`).
- Два entry:
    - `.` — browser‑safe (без FS);
    - `./node` — использует `node:fs`/`node:url`.
- Entry `./contract` — только типы + `defineGranular*` хелперы, без side‑effects.
- Детерминированный порядок layer/preflights.
- Tree‑shake friendly, `sideEffects: ["**/*.css"]`.
- Покрытие: vitest (unit) + интеграционный тест на одном `apps/playground-*`.

---

## 3. Название пакета

Утверждено: **`@feugene/unocss-preset-granular`**.

Расположение: `packages/unocss-preset-granular/` внутри текущей монорепы.

---

## 4. Публичный контракт провайдера

Экспортируется из `@feugene/unocss-preset-granular/contract`.

```ts
export interface GranularComponentDescriptor<Name extends string = string> {
    /** Уникальное (внутри провайдера) имя компонента, напр. "DsButton" */
    name: Name
    /**
     * Зависимости компонента. Поддерживаются три формы (все эквивалентны
     * и могут смешиваться в одном массиве):
     *
     *  1. Короткая: `'DsButton'` — имя компонента в ТОМ ЖЕ провайдере,
     *     что и текущий (провайдер берётся из контекста регистрации).
     *  2. Короткая квалифицированная: `'@feugene/granularity:DsButton'` —
     *     строка `'providerId:ComponentName'`, ссылка на компонент из другого
     *     (или того же) провайдера.
     *  3. Объектная: `{ provider: '@feugene/granularity', components: ['DsButton', 'DsInput'] }` —
     *     полный контракт, удобен когда из одного провайдера нужно подтянуть сразу несколько компонентов.
     *
     * Все зависимости резолвятся через ЕДИНЫЙ РЕЕСТР компонентов, собранный
     * со всех зарегистрированных в `providers` пакетов (см. §7). Ядро пресета
     * рекурсивно обойдёт граф `dependencies` и автоматически соберёт safelist/
     * cssFiles/preflights всех транзитивных зависимостей — декларировать чужие
     * классы в собственном `safelist` композита не нужно.
     */
    dependencies?: readonly GranularComponentDependency[]
    /**
     * UnoCSS safelist — классы, которые обязательно попадут в сборку.
     * Сюда входят ТОЛЬКО СОБСТВЕННЫЕ классы компонента. Классы всех
     * компонентов, перечисленных в `dependencies`, вычисляются автоматически
     * из их конфигов в едином реестре — дублировать их здесь не нужно.
     */
    safelist?: readonly string[]
    /** Абсолютные URL‑строки на CSS‑файлы компонента */
    cssFiles?: readonly string[]
    /** Fallback‑имена ассетов (для dist без сорцов), позиционно к cssFiles */
    cssFileAssetNames?: readonly string[]
    /**
     * Структурные токены, которые ПУБЛИКУЕТ сам компонент для тем приложения.
     * По семантике аналогично `GranularThemeContribution.tokenDefinitions`,
     * но применяется точечно — только если компонент попал в селекцию
     * (через `options.components` или как транзитивная `dependency`).
     *
     * Ключ — имя темы (`light`, `dark`, ...). Значение — `GranularThemeTokenSet`
     * (карта токенов БЕЗ префикса `--` + опциональный `selector`).
     * Пресет эмитит значения токенов только для тех тем, что реально активны
     * в приложении (пересечение с `ThemesOptions.names`).
     *
     * Порядок мержа в итоговый реестр токенов темы (см. §7, Уровень 2):
     *   1) провайдерские `provider.theme.tokenDefinitions[name]`;
     *   2) компонентные `component.tokenDefinitions[name]` — в порядке
     *      `resolveSelection` (post‑order DFS: deps раньше зависящих) —
     *      могут переопределять значения провайдера;
     *   3) `ThemesOptions.tokenOverrides[name]` приложения — высший приоритет.
     */
    tokenDefinitions?: Readonly<Record<string, GranularThemeTokenSet>>
}

export interface GranularThemeTokenSet {
    /**
     * CSS‑селектор, под которым объявлены токены темы (напр. ':root',
     * '[data-theme="dark"]', '.theme-corporate'). Дефолт — ':root'.
     *
     * ВАЖНО (cross‑provider): при слиянии токенов нескольких провайдеров
     * для одной и той же темы селектор берётся у ПЕРВОГО провайдера в
     * порядке `options.providers[]`, у которого эта тема описана в
     * `tokenDefinitions`. Токены остальных провайдеров вливаются в тот же
     * селектор. Это даёт предсказуемый каскад и исключает дублирование.
     */
    selector?: string
    /**
     * Карта токенов БЕЗ префикса `--`.
     * Напр.: { 'color-primary': '#0af', 'radius-lg': '12px' }
     */
    tokens: Readonly<Record<string, string>>
}
export interface GranularThemeContribution {
    /** Базовый CSS (reset/layout‑base), подключается один раз */
    baseCssUrl?: string
    /** CSS с общими токенами, не зависящими от темы */
    tokensCssUrl?: string
    /**
     * Темы, которые провайдер поддерживает, в форме CSS‑файлов.
     * Ключ — имя темы (напр. 'light', 'dark', 'corporate'),
     * значение — URL/path на CSS‑файл с токенами этой темы.
     * Темы из этого словаря подключатся ТОЛЬКО если их имя перечислено
     * в `ThemesOptions.names` конечного приложения.
     *
     * Если для той же темы задан и `tokenDefinitions[name]`, приоритет
     * у `tokenDefinitions`: CSS‑файл из `themes[name]` этого провайдера
     * для данной темы НЕ подключается (чтобы избежать двойного источника).
     */
    themes?: Readonly<Record<string, string>>
    /**
     * Структурная форма темы — реестр токенов провайдера.
     * Ключ — имя темы, значение — набор токенов + селектор.
     *
     * Когда использовать:
     *   - Если нужно дать приложению возможность точечно переопределять
     *     значения токенов через `ThemesOptions.tokenOverrides[name]`.
     *   - Если токены темы проще поддерживать декларативно
     *     (map), чем как сырой CSS‑файл.
     *
     * Сочетание с `themes[name]`: для темы, описанной в `tokenDefinitions`,
     * CSS‑файл из `themes[name]` этого же провайдера НЕ эмитится —
     * вместо него ядро пресета сгенерирует объединённый override‑блок.
     */
    tokenDefinitions?: Readonly<Record<string, GranularThemeTokenSet>>
    /** Имена тем, которые подключить, если пользователь не указал `names` явно */
    defaultThemes?: readonly string[]
}

export interface GranularUnocssContribution {
    rules?: import('@unocss/core').Rule[]
    variants?: import('@unocss/core').Variant[]
    /** Inline‑preflights, не требующие FS (строки/data: CSS или getCSS) */
    preflights?: import('@unocss/core').Preflight[]
}

/** Допустимые формы записи зависимости компонента. */
export type GranularComponentDependency =
    | string                                                // 'Name' | 'providerId:Name'
    | { provider: string; components: readonly string[] }   // объектная форма

export interface GranularProvider {
    /** Уникальный id провайдера, напр. "@feugene/granularity" */
    id: string
    /** Версия контракта — для будущей совместимости */
    contractVersion: 1
    /** Базовый URL пакета (обычно import.meta.url его index) */
    packageBaseUrl: string
    components: readonly GranularComponentDescriptor[]
    theme?: GranularThemeContribution
    unocss?: GranularUnocssContribution
}

export function defineGranularProvider<P extends GranularProvider>(p: P): P

export function defineGranularComponent<N extends string>(
    importMetaUrl: string,
    opts: {
        name: N
        dependencies?: readonly GranularComponentDependency[]
        safelist: readonly string[]
        cssFiles?: readonly string[]
        emitStyleAsset?: boolean
        /** Директория исходников компонента относительно `importMetaUrl`. */
        sourceDir?: string
        /**
         * Структурные токены, публикуемые компонентом для тем приложения.
         * См. `GranularComponentDescriptor.tokenDefinitions`.
         */
        tokenDefinitions?: Readonly<Record<string, GranularThemeTokenSet>>
    },
): GranularComponentDescriptor<N>
```

Примечания по контракту:

- **Cross‑provider зависимости поддерживаются** через единый реестр компонентов (см. §7). Компонент декларирует, какие
  другие компоненты он использует — и, если они из другого провайдера, указывает это в `dependencies` в одной из
  квалифицированных форм (`'providerId:Name'` или `{ provider, components }`). Приложение обязано перечислить всех
  задействованных провайдеров в опции `providers` пресета — иначе резолвер выдаст ошибку `Provider '<id>' is not
  registered`.
- **Приложение само объявляет все нужные провайдеры** как зависимости в своём `package.json`. Провайдеры **не тянут**
  другие провайдеры‑доноры транзитивно: любые сторонние пакеты, на компоненты которых провайдер ссылается в
  `dependencies`, должны быть объявлены у него как `peerDependencies` и установлены конечным приложением.
- **Safelist — строго локальный.** Каждый компонент декларирует только свои классы. Все классы транзитивных
  `dependencies` ядро пресета соберёт автоматически. Это устраняет ручную синхронизацию safelist'ов между композитом
  и примитивами.
- Кастомные `rules`/`variants` приходят **только через `GranularUnocssContribution`** — так провайдер может приносить
  свои utility‑классы, если они ему нужны.

---

## 5. Публичное API пресета

### 5.1. Entry `@feugene/unocss-preset-granular` (browser)

**Зачем нужен.** Это «ядро» пресета, независимое от Node.js API. Используется там, где нет доступа к файловой системе
или где CSS уже собран/инлайнен:

- Сборка UnoCSS в браузерных runtime‑сценариях (`@unocss/runtime`, playground‑in‑browser, песочницы,
  Stackblitz/WebContainers).
- Edge/serverless среды без `node:fs` (CF Workers, Vercel Edge).
- Случаи, когда провайдер уже предоставляет CSS inline через `GranularUnocssContribution.preflights`.
- Переиспользование ядра из node‑варианта (node‑пресет построен **поверх** browser‑варианта).

**Что делает:**

- Принимает список провайдеров и выбор компонентов.
- Строит объединённый `safelist` (с учётом транзитивных `dependencies` внутри провайдера).
- Подключает `rules`/`variants`/`preflights` из `provider.unocss`.
- Навешивает `layer` (если задан) на все preflights без собственного layer.
- **НЕ читает файлы** — любые файловые preflights нужно готовить заранее.

**Когда использовать (уровень применения):**

- В **UI‑библиотеках/демо**, которые собирают стили «на лету» в браузере.
- Как низкоуровневый примитив для построения собственных пресетов.
- В конечных приложениях **НЕ рекомендуется** — используйте `/node` (см. §5.2), если собираете через Vite/Webpack.

**Пример:**

```ts
import {defineConfig} from 'unocss'
import presetWind4 from '@unocss/preset-wind4'
import {presetGranular} from '@feugene/unocss-preset-granular'
import granularityProvider from '@feugene/granularity/granular-provider'

export default defineConfig({
    presets: [
        presetWind4(),
        presetGranular({
            providers: [granularityProvider],
            components: [{provider: '@feugene/granularity', names: ['DsButton']}],
            themes: {names: ['light', 'dark']},
        }),
    ],
})
```

API:

```ts
import type {Preset} from 'unocss'
import type {GranularProvider} from './contract'

export interface ThemesOptions {
    /**
     * Имена тем, которые попадут в конечную сборку приложения.
     *
     * Правило: подключается только пересечение этого списка с `provider.theme.themes`
     * каждого провайдера. Если у конкретного провайдера темы нет — он её не подключает.
     *
     * Поведение по умолчанию (если поле не задано):
     *   - Используется единственная дефолтная тема `'light'`.
     *   - Это значение зашито в ядре пресета и не зависит от `provider.theme.defaultThemes`.
     *   - Провайдер, у которого нет темы `light`, её просто не подключит.
     *
     * Чтобы подключить больше одной темы — нужно перечислить их явно,
     *   например `names: ['light', 'dark']`.
     * Чтобы не подключать никаких тем — передать `names: []`.
     */
    names?: readonly string[]
    /** Переопределить base.css провайдера (глобально или по providerId) */
    baseFile?: string | Partial<Record<string, string>>
    /** Переопределить tokens.css провайдера */
    tokensFile?: string | Partial<Record<string, string>>
    /**
     * УРОВЕНЬ 1 — Полная замена CSS‑файла темы.
     *
     * Ключ — имя темы (как в `names`). Значение — либо один путь/URL
     * (применяется ко всем провайдерам, у кого эта тема есть), либо объект
     * per `providerId` (точечная замена для конкретного провайдера).
     *
     * Семантика — «replace»: при наличии override провайдерский
     * `theme.themes[name]` **не подключается**, вместо него читается файл
     * из этой опции. Поддерживаются абсолютные пути, `file://`‑URL и
     * `data:text/css,...` (inline).
     *
     * Темы, для которых override не задан, берутся из `provider.theme.themes`
     * как обычно.
     */
    themeFiles?: Partial<Record<
        string /* themeName */,
        string | Partial<Record<string /* providerId */, string>>
    >>
    /**
     * УРОВЕНЬ 2 — Точечный override значений токенов конкретной темы.
     *
     * Ключ — имя темы, значение — карта `{ tokenName: value }` БЕЗ префикса `--`.
     *
     * Как работает:
     *   1. Ядро собирает реестр токенов темы со всех провайдеров,
     *      у которых есть `provider.theme.tokenDefinitions[name]`.
     *   2. Сверху мержатся `tokenOverrides[name]` приложения
     *      (последний источник — побеждает).
     *   3. В итоговый CSS эмитится один блок
     *      `<selector> { --k: v; ... }` на тему, ВМЕСТО CSS‑файлов тем
     *      тех провайдеров, что перешли на `tokenDefinitions`.
     *   4. Для провайдеров, которые остались на файловой форме
     *      (`theme.themes[name]` без `tokenDefinitions[name]`),
     *      `tokenOverrides` игнорируется (с `console.warn` в dev),
     *      и их CSS‑файл по‑прежнему читается как раньше.
     *      Для таких провайдеров применяйте Уровень 1 (`themeFiles`).
     *
     * Неизвестные токены (которых нет ни у одного провайдера) по умолчанию
     * добавляются в блок (lenient). Строгий режим — через `strictTokens: true`.
     */
    tokenOverrides?: Partial<Record<
        string /* themeName */,
        Readonly<Record<string /* tokenName */, string>>
    >>
    /**
     * Строгий режим для `tokenOverrides`: если override содержит токен,
     * который ни один провайдер не декларировал в `tokenDefinitions[name]`,
     * пресет бросает ошибку `UnknownTokenOverrideError`.
     * Default: `false` (lenient — токен просто добавляется).
     */
    strictTokens?: boolean
}

export type ComponentSelection =
    | 'all'
    | readonly (
    | { provider: string; names: 'all' | readonly string[] }
    | `${string}:${string}` // короткая форма "providerId:ComponentName"
    )[]

export interface PresetGranularOptions {
    providers: readonly GranularProvider[]
    components?: ComponentSelection
    themes?: ThemesOptions
    layer?: string
    /** Дополнительные preflights приложения */
    preflights?: readonly import('unocss').Preflight[]
    /** Подключать ли rules/variants/preflights от провайдеров (default: true) */
    includeProviderUnocss?: boolean
}

export function presetGranular(options: PresetGranularOptions): Preset
```

### 5.2. Entry `@feugene/unocss-preset-granular/node` (node)

**Зачем нужен.** Это надстройка над browser‑ядром, использующая `node:fs` и `node:url` для **чтения CSS‑файлов**
провайдеров с диска и превращения их в `preflights` UnoCSS:

- CSS‑файлы компонентов (`provider.components[].cssFiles`) — читаются и конкатенируются.
- `base.css`, `tokens.css`, файлы тем (`provider.theme.themes[name]`) — читаются и инлайнятся в preflights.
- Поддержка `data:text/css,...` URL и абсолютных путей.
- Fallback `src/ ↔ dist/`: если пакет собран, исходник может отсутствовать — подхватываются `cssFileAssetNames`.

**Что делает (в дополнение к browser):**

- Формирует preflights из файлов по детерминированному порядку.
- Дедуплицирует CSS по абсолютному пути файла.
- Для каждого провайдера читает **пересечение** `themes.names` (из опций приложения) и `provider.theme.themes` (что
  провайдер реально поставляет). Если темы нет у провайдера — он её просто пропускает, без ошибки. В итоговом бандле
  окажутся только те темы, которые явно указаны приложением И есть у хотя бы одного провайдера.

**Когда использовать (уровень применения):**

- В **конечных приложениях**, собираемых через Vite/Webpack/Rolldown (наш основной кейс — `apps/playground-*`).
- В SSG/SSR сборках Nuxt/Astro, где UnoCSS работает на сервере при билде.
- В любом build‑time сценарии, где есть доступ к FS.

**Не использовать:**

- В браузерных runtime‑сценариях — там только `.` entry (см. §5.1).

**Пример:**

```ts
import {defineConfig} from 'unocss'
import presetWind4 from '@unocss/preset-wind4'
import {presetGranularNode} from '@feugene/unocss-preset-granular/node'
import granularityProvider from '@feugene/granularity/granular-provider/node'
import extraProvider from '@feugene/extra-granularity/granular-provider/node'

export default defineConfig({
    presets: [
        presetWind4(),
        presetGranularNode({
            providers: [granularityProvider, extraProvider],
            components: [
                {provider: '@feugene/granularity', names: ['DsButton', 'DsInput']},
                '@feugene/extra-granularity:XgQuickForm',
            ],
            themes: {names: ['light', 'dark']}, // только эти темы попадут в бандл — и лишь у тех провайдеров, у кого они есть
            layer: 'granular',
        }),
    ],
})
```

API:

```ts
export type PresetGranularNodeOptions = PresetGranularOptions

export function presetGranularNode(options: PresetGranularNodeOptions): Preset

export function resolvePresetGranularNodePreflights(options: PresetGranularNodeOptions): import('unocss').Preflight[]

export function getGranularComponentCssFiles(options: PresetGranularNodeOptions): Promise<string[]>

export function getGranularComponentCss(options: PresetGranularNodeOptions): Promise<string>

export function getGranularThemeCss(options: PresetGranularNodeOptions): Promise<string>
```

### 5.3. Entry `@feugene/unocss-preset-granular/contract`

Только типы + `defineGranularProvider` + `defineGranularComponent`. Импортируется **провайдерами**, а не приложением.

### 5.4. Различия browser vs node (сводка)

| Свойство                                           | `/` (browser)   | `/node`            |
|----------------------------------------------------|-----------------|--------------------|
| Ядро: safelist, rules, variants, layer             | ✅               | ✅ (через browser)  |
| Provider `unocss.preflights` (inline)              | ✅               | ✅                  |
| Чтение `cssFiles` компонентов с диска              | ❌               | ✅                  |
| Чтение `base.css`/`tokens.css` с диска             | ❌               | ✅                  |
| Чтение файлов тем (пересечение со списком `names`) | ❌ (inline only) | ✅                  |
| Поддержка `data:text/css` URL                      | ✅               | ✅                  |
| Зависимость от `node:fs`                           | нет             | есть (peer — нода) |
| Рекомендованный сценарий                           | runtime, edge   | build‑time (Vite)  |

---

## 6. Что становится с существующими пакетами

### 6.1. `@feugene/granularity`

- Текущие `src/unocss/preset.ts` и `src/unocss/preset.node.ts` — **удаляются без deprecated‑обёрток**. Вся логика
  пресета переезжает в `@feugene/unocss-preset-granular`. Пакет `@feugene/granularity` перестаёт быть поставщиком
  UnoCSS‑пресета и становится чистым **поставщиком провайдера + компонентов + тем**.
- Экспорты `presetGranularity`, `presetGranularityNode` и сопутствующие хелперы (`resolvePresetGranularity*`,
  `createGranularityCssPreflight*`, `granularitySafelist`, `granularityThemeUrls`, ...) — **удаляются из публичного
  API**. Переход приложений — сразу на новый пресет (см. migration guide).
- Новые entry:
    - `@feugene/granularity/granular-provider` (browser) — возвращает `GranularProvider` без FS.
    - `@feugene/granularity/granular-provider/node` (node) — то же, но с path‑резолвом для fallback `src/↔dist/`.
- Текущие `rules/animation|spacing|colorOpacity|filters` — **уходят** из «ядра» пресета, так как новый стек использует
  `@unocss/preset-wind4`. Те из них, что всё ещё нужны granularity‑компонентам, **переезжают
  в `granularityProvider.unocss.rules/variants/preflights`**. Остальные удаляются.
- `themeRegistry.ts` и `themeRegistry.node.ts` адаптируются: данные о `base.css`, `tokens.css`, темах (`light`,
  `dark`, ...) упаковываются в `GranularThemeContribution` провайдера. Node‑FS логика переезжает в новый пакет.
- Версионирование: изменение оформляется как **breaking‑change мажор** `@feugene/granularity` — без промежуточного
  цикла с `@deprecated`.

### 6.2. `@feugene/extra-granularity`

- Для каждого композитного компонента (`XgQuickForm`, ...) добавляется `config.ts` с `defineGranularComponent(...)`.
- **Самодостаточность композита — обязательна и достигается автоматически** через единый реестр компонентов.
  Композит **только** декларирует свои `dependencies` (в т.ч. cross‑provider) и **только свои** классы в `safelist`.
  Ядро пресета рекурсивно обходит граф зависимостей и собирает `safelist`, `cssFiles`, provider‑preflights всех
  транзитивных потребляемых компонентов. **Дублировать чужие классы в собственном `safelist` НЕ нужно — это антипаттерн:**
  при изменении примитива пришлось бы править все композиты вручную.
- Приложение перечисляет в `components` только сам композит:
  `presetGranularNode({ providers: [...], components: ['@feugene/extra-granularity:XgQuickForm'], ... })`.
  Примитивы из другого провайдера (`@feugene/granularity`) подтянутся автоматически — если этот провайдер передан в
  `providers`.
- **Обязанности приложения:**
    1. Добавить все нужные провайдеры в `package.json` (как обычные `dependencies`).
    2. Импортировать и передать их в `presetGranular*({ providers: [...] })`.
    Если в `dependencies` встречается `providerId`, которого нет в `providers`, резолвер выдаёт ошибку с подсказкой,
    какой именно провайдер не зарегистрирован и какой компонент на него ссылается.
- **Ответственность провайдера‑композита:** в своём `package.json` объявить провайдеры‑доноры (например
  `@feugene/granularity`) как `peerDependencies`. Транзитивной установкой провайдеров‑доноров занимается только
  конечное приложение.
- Экспорт: `@feugene/extra-granularity/granular-provider` (+`/node`).

#### 6.2.1. Пример конфигурации `XgQuickForm` с cross‑provider `dependencies`

Пусть в `extra‑granularity` есть композит `XgFormActions` (панель кнопок), который использует `DsButton` из
`@feugene/granularity`. А `XgQuickForm` использует `XgFormActions` (свой провайдер) и дополнительно `DsInput` +
`DsFormField` из granularity. **Ни один из композитов не перечисляет чужие классы в своём `safelist`** — они придут
автоматически по графу `dependencies` через единый реестр (§7).

```ts
// packages/extra-granularity/src/components/XgFormActions/config.ts
import {defineGranularComponent} from '@feugene/unocss-preset-granular/contract'

export const xgFormActionsConfig = defineGranularComponent(import.meta.url, {
    name: 'XgFormActions',
    dependencies: [
        // cross-provider — любая из форм ниже эквивалентна:
        '@feugene/granularity:DsButton',
        // { provider: '@feugene/granularity', components: ['DsButton'] },
    ],
    safelist: [
        // ТОЛЬКО собственные классы:
        'xg-form-actions',
        'xg-form-actions__slot',
    ],
    cssFiles: ['./styles.css'],
})
```

```ts
// packages/extra-granularity/src/components/XgQuickForm/config.ts
import {defineGranularComponent} from '@feugene/unocss-preset-granular/contract'

export const xgQuickFormConfig = defineGranularComponent(import.meta.url, {
    name: 'XgQuickForm',
    dependencies: [
        // короткая форма — провайдер текущего компонента (extra-granularity):
        'XgFormActions',
        // cross-provider (квалифицированная строка):
        '@feugene/granularity:DsInput',
        // cross-provider (объектная форма — удобно для списка):
        {provider: '@feugene/granularity', components: ['DsFormField']},
    ],
    safelist: [
        // ТОЛЬКО собственные классы:
        'xg-quick-form',
        'xg-quick-form__row',
        'xg-quick-form__error',
    ],
    cssFiles: ['./styles.css'],
})
```

```ts
// packages/extra-granularity/src/granular-provider/index.ts
import {defineGranularProvider} from '@feugene/unocss-preset-granular/contract'
import {xgFormActionsConfig} from '../components/XgFormActions/config'
import {xgQuickFormConfig} from '../components/XgQuickForm/config'

export default defineGranularProvider({
    id: '@feugene/extra-granularity',
    contractVersion: 1,
    packageBaseUrl: import.meta.url,
    components: [xgFormActionsConfig, xgQuickFormConfig],
})
```

Использование в приложении — достаточно указать **только** целевой композит:

```ts
// uno.config.ts
presetGranularNode({
    providers: [granularityProvider, extraProvider],
    components: ['@feugene/extra-granularity:XgQuickForm'],
    themes: {names: ['light']},
    layer: 'granular',
})
```

Этот конфиг и конфиг с ручным перечислением примитивов — **эквивалентны по итоговому CSS/safelist**, потому что
`XgQuickForm` транзитивно резолвится в `{XgFormActions, DsInput, DsFormField, DsButton}`:

```ts
// ЭКВИВАЛЕНТНО предыдущему — дубли дедуплицируются:
presetGranularNode({
    providers: [granularityProvider, extraProvider],
    components: [
        '@feugene/extra-granularity:XgQuickForm',
        '@feugene/granularity:DsButton',
        '@feugene/granularity:DsInput',
        '@feugene/granularity:DsFormField',
    ],
    themes: {names: ['light']},
    layer: 'granular',
})
```

> **Правила для автора компонента:**
> - В `safelist` — только собственные классы. Никогда не дублируйте классы зависимостей.
> - Все фактически используемые в шаблоне компоненты из других пакетов обязаны быть перечислены в `dependencies`
>   (короткой, строчной квалифицированной или объектной формой — любой).
> - Короткая форма `'Name'` предназначена ТОЛЬКО для компонентов ТОГО ЖЕ провайдера, где регистрируется текущий компонент.
>
> **Правила для приложения:**
> - Все провайдеры, на компоненты которых есть ссылки в `dependencies`, должны быть переданы в `providers`.
>   Если нет — резолвер кинет ошибку вида `Component '@feugene/granularity:DsButton' requires provider
>   '@feugene/granularity' which is not registered in 'providers'`.
> - Тот же набор провайдеров должен быть установлен в `package.json` приложения (провайдеры — peer друг другу).

### 6.3. Конечное приложение (пример `apps/playground-5`)

```ts
// uno.config.ts
import {defineConfig} from 'unocss'
import presetWind4 from '@unocss/preset-wind4'
import {presetGranularNode} from '@feugene/unocss-preset-granular/node'
import granularityProvider from '@feugene/granularity/granular-provider/node'

export default defineConfig({
    content: {
        pipeline: {include: [/apps\/playground-5\/src\/.*\.(vue|ts)($|\?)/]},
    },
    presets: [
        presetWind4(),
        presetGranularNode({
            providers: [granularityProvider],
            components: ['@feugene/granularity:DsButton'],
            themes: {names: ['light']},
            layer: 'granular',
        }),
    ],
})
```

---

### 6.4. Use‑cases: компонентные токены (`component.tokenDefinitions`)

Каждый компонент может публиковать собственные CSS‑токены темы — по аналогии
с `provider.theme.tokenDefinitions`, но точечно. Пресет выгружает значения
только для тем, реально активных в приложении (пересечение с
`ThemesOptions.names`), и только если компонент попал в селекцию (через
`options.components` или как транзитивная `dependency`). Приоритет:
**провайдер → компонент (в порядке `resolveSelection`) → `tokenOverrides`**.

#### 6.4.1. Компонент публикует свой токен (single‑theme сборка)

Кейс: в приложении включена только `light`, компонент описывает токены для
обеих тем — в сборку попадут только значения для `light`.

```ts
// packages/simple-package/src/components/XTokenized/config.ts
import {defineGranularComponent} from '@feugene/unocss-preset-granular/contract'
import {tokenDefinitionsFromCssSync} from '@feugene/unocss-preset-granular/node'

const lightUrl = new URL('./themes/light.css', import.meta.url).href
const darkUrl  = new URL('./themes/dark.css',  import.meta.url).href

export const xTokenizedConfig = defineGranularComponent(import.meta.url, {
    name: 'XTokenized',
    safelist: [],
    tokenDefinitions: {
        light: tokenDefinitionsFromCssSync(lightUrl, {selector: ':root'}),
        dark:  tokenDefinitionsFromCssSync(darkUrl,  {as: '.dark, [data-theme="dark"]'}),
    },
})
```

```vue
<!-- XTokenized.vue — компонент потребляет свой же токен -->
<template>
    <div class="bg-[var(--x-tokenized)] p-4"><slot/></div>
</template>
```

```ts
// uno.config.ts приложения — активна только light
presetGranularNode({
    providers: [simpleProvider],
    components: ['simple:XTokenized'],
    themes: {names: ['light']}, // в CSS попадут ТОЛЬКО light‑значения
})
```

Результат (фрагмент итогового CSS):

```css
:root { --x-tokenized: /* значение из light.css */; }
/* блока .dark { --x-tokenized: ... } в сборке НЕТ */
```

#### 6.4.2. Multi‑theme сборка

Приложение просит и `light`, и `dark` — пресет эмитит оба блока под
селекторами компонента.

```ts
presetGranularNode({
    providers: [simpleProvider],
    components: ['simple:XTokenized'],
    themes: {names: ['light', 'dark']},
})
```

```css
:root                         { --x-tokenized: <light-value>; }
.dark, [data-theme="dark"]    { --x-tokenized: <dark-value>;  }
```

#### 6.4.3. Компонент переопределяет токен провайдера

Провайдер объявляет `--primary`, компонент специализирует его (локально
для всех экземпляров, где активна выбранная тема):

```ts
// provider.theme.tokenDefinitions.light.tokens.primary = 'blue'
// component.tokenDefinitions.light.tokens.primary     = 'green'
```

Итоговый блок темы (селектор — от первого провайдера, напр. `:root`):

```css
:root { --primary: green; /* провайдер: blue → компонент: green */ }
```

Если в селекцию попадают несколько компонентов, «побеждает» последний в
post‑order `resolveSelection` (deps раньше зависящих).

#### 6.4.4. Конечное приложение перебивает всех (высший приоритет)

`ThemesOptions.tokenOverrides` применяется **поверх** и провайдеров, и
компонентов, а также может добавлять новые токены:

```ts
presetGranularNode({
    providers: [simpleProvider],
    components: ['simple:XTokenized'],
    themes: {
        names: ['light'],
        tokenOverrides: {
            light: {
                'primary':     'crimson', // перебивает и провайдера, и компонент
                'x-tokenized': 'orange',  // перебивает компонент
                'app-only':    'cyan',    // новый токен от приложения
            },
        },
    },
})
```

```css
:root {
    --primary:     crimson;
    --x-tokenized: orange;
    --app-only:    cyan;
}
```

#### 6.4.5. `strictTokens` и компонентные токены

В строгом режиме (`strictTokens: true`) override считается валидным, если
токен объявлен **хотя бы одним источником** — провайдером ИЛИ компонентом.
Неизвестные токены отфильтровываются с `console.warn`.

```ts
presetGranularNode({
    providers: [simpleProvider],
    components: ['simple:XTokenized'], // публикует 'x-tokenized'
    themes: {
        names: ['light'],
        strictTokens: true,
        tokenOverrides: {
            light: {
                'x-tokenized': 'orange', // ✅ известен (от компонента)
                'primary':     'green',  // ✅ известен (от провайдера)
                'unknown':     'nope',   // ⚠️ warn + отфильтрован
            },
        },
    },
})
```

#### 6.4.6. Компонент создаёт тему с нуля

Если ни один провайдер не объявлял тему `corporate`, а компонент —
объявил, то при `names: ['corporate']` пресет создаст блок с нуля.
Селектор берётся из первого `tokenDefinition`, содержащего `selector`
(иначе — дефолтный `':root'`).

```ts
defineGranularComponent(import.meta.url, {
    name: 'XTokenized',
    safelist: [],
    tokenDefinitions: {
        corporate: {selector: '.theme-corporate', tokens: {'x-tokenized': 'gold'}},
    },
})
```

```css
.theme-corporate { --x-tokenized: gold; }
```

---

## 7. Ключевые алгоритмы

- **Регистр провайдеров**: `Map<string, GranularProvider>` по `id`; дубликаты id → ошибка.
- **Единый реестр компонентов**: поверх регистра провайдеров строится плоская мапа
  `Map<'providerId:Name', { provider, descriptor }>`. Это единая точка lookup'а для резолва зависимостей — любой
  компонент любого провайдера находится за O(1) по квалифицированному ключу.
- **Нормализация зависимости**:
    - строка без `':'` → `'<ownProviderId>:<Name>'` (провайдер, в котором зарегистрирован компонент‑владелец);
    - строка с `':'` → как есть (`'providerId:Name'`);
    - объектная форма `{ provider, components: [...] }` → раскладывается в N квалифицированных ключей.
- **Резолв выбора компонентов (рекурсивный)**:
    1. Нормализация входа `components`: `'providerId:Name'`/объектная форма → `{provider, names}`; `'all'` на корне → все
       провайдеры; `names: 'all'` → полный список компонентов провайдера.
    2. Для каждого начального `providerId:Name` — DFS по графу `dependencies` в едином реестре.
    3. На каждом шаге ключ зависимости строится по правилам нормализации выше; если ключ отсутствует в реестре —
       различаем ошибки:
        - провайдер не зарегистрирован → `ProviderNotRegisteredError` с подсказкой (`add '<id>' to providers`);
        - провайдер есть, но компонента нет → `ComponentNotFoundError` с перечислением доступных.
    4. Детекция циклов (в т.ч. cross‑provider) — ошибка `CircularDependencyError` с цепочкой.
    5. Итоговое множество посещённых компонентов — это **полный** набор для сборки.
- **Safelist**: union `safelist` ВСЕХ посещённых компонентов (включая транзитивные deps) → `Set<string>`. Каждый
  компонент декларирует только собственные классы; ядро собирает их вместе автоматически.
- **CSS‑файлы**: union `cssFiles` всех посещённых компонентов; дедуп по абсолютному пути.
- **Порядок топосорта**: deps идут раньше зависящих (DFS post‑order) — важно для каскада стилей композитов поверх
  примитивов.
- **Темы**:
    - Пользователь указывает `themes.names` — плоский список имён тем, которые будут в конечной сборке.
    - Если `themes.names` не задан → по умолчанию используется ровно одна тема: **`['light']`** (дефолт ядра пресета, не
      зависит от провайдеров).
    - Если передан пустой массив `themes.names: []` — темы не подключаются вовсе.
    - Для каждого провайдера подключаются только те темы, для которых выполнены **оба** условия:
        1. имя темы присутствует в итоговом `themes.names` (в т.ч. дефолтном `['light']`);
        2. имя темы присутствует у провайдера либо в `provider.theme.themes`, либо в `provider.theme.tokenDefinitions`.
    - Если провайдер не содержит запрошенной темы — он её просто не подключает (ошибки нет). Если ни у одного провайдера
      запрошенной темы нет — пресет выдаёт предупреждение в dev‑логах.
- **Override тем (Уровень 1 — `themeFiles`)**:
    - Для каждой темы из `themes.names` и каждого провайдера, у которого эта тема есть в `provider.theme.themes`,
      проверяется `options.themes.themeFiles[themeName]`:
        - строка → полная замена CSS‑файла темы для всех провайдеров;
        - объект `{ [providerId]: path }` → замена только у конкретного провайдера;
        - отсутствует → используется `provider.theme.themes[themeName]` как раньше.
    - Поддерживаются `data:text/css,...` URL, абсолютные пути и `file://`.
- **Реестр токенов тем (Уровень 2 — `tokenDefinitions` + `tokenOverrides`)**:
    1. Ядро собирает `Map<themeName, { selector, tokens: Map<tokenName, value> }>` по всем провайдерам,
       у которых есть `provider.theme.tokenDefinitions[themeName]`, **в порядке `options.providers[]`**.
    2. Селектор темы фиксируется по ПЕРВОМУ провайдеру, объявившему эту тему (дефолт `':root'`). Токены остальных
       провайдеров вливаются в тот же селектор; при конфликте имён токенов выигрывает последний источник в порядке
       `providers[]`.
    3. **Компонентный слой (`component.tokenDefinitions`)** — сверху провайдерских вливаются токены, опубликованные
       самими компонентами, которые попали в `resolveSelection` (включая транзитивные `dependencies`). Порядок —
       post‑order DFS `resolveSelection` (deps раньше зависящих). Компонент может:
        - переопределить значение провайдерского токена в рамках одной темы;
        - добавить свой собственный токен (напр. `--x-tokenized`) без правки провайдера;
        - создать тему с нуля, если ни один провайдер её не объявлял (селектор возьмётся из первого `tokenDefinition`,
          содержащего `selector`; иначе — дефолт `':root'`).
       Неактивные темы (`themeName ∉ ThemesOptions.names`) игнорируются — их токены НЕ эмитятся.
    4. Сверху мержится `options.themes.tokenOverrides[themeName]` (побеждает и провайдеров, и компоненты).
    5. Эмитится единый override‑CSS‑блок `<selector> { --k: v; … }` **вместо** CSS‑файлов тех провайдеров, что
       объявили `tokenDefinitions[themeName]`. Провайдеры без структурной формы продолжают эмитить свой
       `theme.themes[themeName]` (и на них действует только Уровень 1).
    6. Если `strictTokens: true` и override содержит токен, которого нет **ни у одного провайдера, ни у одного
       компонента** в `tokenDefinitions[themeName]` — override игнорируется с `console.warn`
       (lenient‑режим, default — добавляет такие токены в блок). Токены, пришедшие от компонентов, считаются
       «известными» наравне с провайдерскими.
- **Порядок preflights (итоговый):**
  `tokensCss → baseCss → [token‑override‑block per theme] → [legacy theme CSS файлы провайдеров без tokenDefinitions, per requested name] → [themeFiles override (Уровень 1) для оставшихся] → component CSS → provider.unocss.preflights → options.preflights`.
- **Дедупликация**:
    - safelist — `Set<string>`;
    - CSS‑файлы — `Set<string>` (абсолютный путь);
    - rules/variants — по ссылке (`Set`).
- **Layer**: если `options.layer` задан, применяется ко всем preflights без собственного layer.

---

## 8. Структура репозитория

```
packages/
  unocss-preset-granular/               ← НОВЫЙ пакет
    src/
      contract/
        index.ts                        # типы + defineGranular*
      core/
        resolveSelection.ts
        resolveThemes.ts
        dedupe.ts
        layer.ts
      preset.ts                         # presetGranular (browser)
      preset.node.ts                    # presetGranularNode (FS)
      fs/
        readCss.ts                      # read + data: + fallback src↔dist
      index.ts                          # re-export preset + contract
      node.ts                           # re-export preset.node
    package.json                        # exports: ".", "./node", "./contract"
    README.md
  granularity/
    src/granular-provider/
      index.ts                          # browser provider
      node.ts                           # node provider
    src/unocss/preset.ts                # ← deprecated shim
    src/unocss/preset.node.ts           # ← deprecated shim
  extra-granularity/
    src/components/XgQuickForm/config.ts
    src/granular-provider/
      index.ts
      node.ts
```

---

## 9. Тестирование

- Unit: `resolveSelection`, транзитивные deps, `resolveThemes` (пересечение `themes.names` и `provider.theme.themes`,
  дефолт `['light']` при отсутствии `names`, пустой массив → нет тем, пропуск отсутствующих у провайдера тем), дедуп,
  data‑URL, fallback src/dist.
- Unit `themeFiles` (Уровень 1): полная замена CSS‑файла темы строкой; per‑providerId override; отсутствие override →
  используется `provider.theme.themes[name]`; совместимость с `data:text/css,...`.
- Unit `tokenDefinitions` + `tokenOverrides` (Уровень 2): селектор из первого провайдера; слияние токенов в порядке
  `providers[]`; победа `tokenOverrides` над всеми провайдерами; режим `strictTokens: true` — ошибка
  `UnknownTokenOverrideError`; lenient‑режим — неизвестные токены добавляются; приоритет `tokenDefinitions[name]` над
  `themes[name]` у того же провайдера.
- Unit `component.tokenDefinitions` (Уровень 2, компонентный слой): компонентные токены мержатся поверх провайдерских
  в порядке `resolveSelection`; неактивные темы (не вошедшие в `ThemesOptions.names`) игнорируются; компонент может
  создать тему с нуля, если ни один провайдер её не объявлял; цепочка приоритетов
  **провайдер → компонент → `tokenOverrides`** (приложение перебивает всех, в т.ч. добавляет новые токены);
  `strictTokens: true` признаёт компонентные токены «известными».
- Snapshot итогового CSS: провайдер с `tokenDefinitions` + `tokenOverrides` эмитит один override‑блок вместо
  `themes[name]`; провайдер без `tokenDefinitions` получает только Уровень 1; mixed‑режим (оба типа провайдеров одновременно).
- Snapshot: итоговый CSS для фикстурного набора компонентов.
- Интеграция: `apps/playground-5` пересобирается на новый пресет; diff итогового CSS с baseline.
- Типы: `expectTypeOf` на публичном API.

---

## 10. Миграция / обратная совместимость

- **Обратная совместимость не поддерживается** — deprecated‑shim'ы не создаются. Старые экспорты
  `presetGranularity`/`presetGranularityNode` удаляются одним мажором вместе с публикацией нового пакета
  `@feugene/unocss-preset-granular`.
- План релиза:
    1. `@feugene/unocss-preset-granular@0.1.0` — первый релиз.
    2. `@feugene/granularity` — мажорный релиз: удалены `src/unocss/*` и связанные публичные хелперы; добавлены
       `granular-provider` (browser + node).
    3. `@feugene/extra-granularity` — мажорный релиз: добавлены `config.ts` компонентов и `granular-provider`.
    4. Все `apps/playground-*` переведены на новый пресет в том же PR‑потоке; baseline CSS сверяется со старым.
- Публикуется короткий **migration guide** в README новых пакетов и в CHANGELOG: пошаговая замена `uno.config.ts`
  (импорт, опции, layer, темы).

---

## 11. Definition of Done

- Новый пакет собирается и публикуется, есть README.
- `granularity` и `extra-granularity` экспортируют `granular-provider` (browser+node).
- Все `apps/playground-*` работают на новом пресете.
- Старые экспорты `presetGranularity*` и связанные хелперы **удалены** из `@feugene/granularity` (без deprecated‑shim'ов).
- CI зелёный, unit + интеграционные тесты есть.
- Migration guide опубликован в README и CHANGELOG.

---

## 12. Решения по открытым вопросам (утверждены)

1. Имя пакета — **`@feugene/unocss-preset-granular`**.
2. Rules/variants из старого пресета — **убираются**, так как переходим на `@unocss/preset-wind4`. В публичном контракте
   **остаётся** возможность провайдерам поставлять кастомные `rules`/`variants` через `GranularUnocssContribution`.
3. Темы — **встроены в ядро пакета**:
    - Единый контракт `GranularThemeContribution`.
    - Провайдер описывает темы как плоский `Record<themeName, cssUrl>`, где ключ — имя темы (`light`, `dark`,
      `corporate`, ...), значение — URL/path на CSS с токенами.
    - Приложение перечисляет имена тем в `themes.names`. Подключаются только те, которые **есть у провайдера И
      перечислены приложением**. Нет темы у провайдера — он её пропускает без ошибки.
    - **По умолчанию** (если `themes.names` не передан) подключается одна тема — **`light`**. Это жёсткий дефолт ядра
      пресета, он не зависит от `provider.theme.defaultThemes` и намеренно выбран как самый предсказуемый минимум.
    - Чтобы получить несколько тем — перечислить их явно (`['light', 'dark']`); чтобы отключить темы — передать `[]`.
    - Никаких `mode`/`variant`/`extra` в опциях нет — контракт намеренно минимален.
    - Тема = набор токенов (один CSS файл на тему).
    - **Override тем в приложении — два уровня** (реализуются вместе в рамках одного мажора):
        - **Уровень 1 (`ThemesOptions.themeFiles`)** — полная замена CSS‑файла темы. Глобально (строкой) или per
          `providerId` (объектом). Семантика — «replace»: вместо `provider.theme.themes[name]` подключается указанный
          файл/`data:`‑URL. Нулевое изменение контракта провайдера.
        - **Уровень 2 (`GranularThemeContribution.tokenDefinitions` + `ThemesOptions.tokenOverrides`)** — точечный
          override значений токенов. Провайдер декларирует структурную форму темы
          (`{ selector?, tokens: Record<name, value> }`), ядро собирает единый реестр токенов на тему со всех
          провайдеров в порядке `options.providers[]` и вливает `tokenOverrides` приложения сверху (выигрывают).
          Для темы с `tokenDefinitions[name]` CSS‑файл `themes[name]` того же провайдера **не эмитится** — вместо
          него генерируется один override‑блок `<selector> { --k: v; … }`. Для провайдеров, оставшихся на файловой
          форме, `tokenOverrides` игнорируется (с `console.warn` в dev) — используйте для них Уровень 1.
        - Селектор темы фиксируется по **первому** провайдеру в порядке `providers[]`, объявившему эту тему в
          `tokenDefinitions`; дефолт — `':root'`.
        - Неизвестные токены в override по умолчанию добавляются (lenient). Строгий режим — `strictTokens: true`
          (кидает `UnknownTokenOverrideError`).
4. Cross‑provider зависимости — **поддерживаются** (решение обновлено). Реализуются через единый реестр компонентов
   (§7). Доступны три формы записи зависимости (`'Name'`, `'providerId:Name'`, `{ provider, components }`).
   Компоненты декларируют только собственный `safelist`, транзитивные классы собираются ядром
   автоматически. Приложение обязано перечислить всех задействованных провайдеров в `providers` пресета и
   установить их в `package.json` (провайдеры — peer друг другу).
5. Режим `safelist: 'auto' | 'always'` — **не делаем**. UnoCSS уже сканирует content. `safelist` нужен только для
   классов, которые UnoCSS не увидит (динамические, условные, из runtime). Делаем: по умолчанию safelist провайдера *
   *включается** для выбранных компонентов; если разработчик уверен, что всё статически видно, он может просто не
   выбирать компоненты, а положиться на scanner.
6. Нейминг — **`Granular*`** (без `ity`), нейтральный для сторонних DS‑провайдеров.
7. Расположение — **монорепа**, `packages/unocss-preset-granular/`.

---

## 13. План реализации (этапность)

1. Скелет пакета `packages/unocss-preset-granular` + build‑конфиг (по образу `granularity`), exports `./`, `./node`,
   `./contract`.
2. Контракт: `GranularComponentDescriptor`, `GranularThemeContribution`, `GranularUnocssContribution`,
   `GranularProvider`, `defineGranular*`.
3. Core‑резолверы: `resolveSelection`, `resolveThemes` (пересечение `names` и `provider.theme.themes`, дефолт
   `['light']` когда `names` не задан, пустой массив → нет тем), `dedupe`, `applyLayer`, транзитивный топосорт
   зависимостей — с unit‑тестами.
4. Browser preset `presetGranular`: safelist + provider `unocss.*` + пользовательские preflights.
5. Node‑слой: `fs/readCss.ts` (read + `data:` + fallback `src↔dist`), параметризованный `packageBaseUrl` провайдера.
6. Node preset `presetGranularNode`: оборачивает `presetGranular`, докидывает FS‑preflights для
   base/tokens/тем/компонентов.
7. `@feugene/granularity`:
    - Создаём `granular-provider` (browser + node).
    - `animation|spacing|colorOpacity|filters` — инвентаризация: нужное уносим в `granularityProvider.unocss`, остальное
      удаляем.
    - **Удаляем** `src/unocss/preset.ts`, `src/unocss/preset.node.ts` и все связанные публичные экспорты
      (`presetGranularity*`, `resolvePresetGranularity*`, `createGranularityCssPreflight*`, `granularitySafelist`,
      `granularityThemeUrls` и т. п.) без deprecated‑обёрток. Bump — major.
8. `@feugene/extra-granularity`:
    - Пишем `config.ts` для `XgQuickForm`.
    - Создаём `granular-provider` (browser + node).
9. Перевод `apps/playground-5` на новый пресет, baseline‑diff итогового CSS.
10. Перевод остальных `apps/playground-*` последовательно, где сейчас используется unocss.
11. **Theme overrides** (фичи сделаны вместе, одним мажором пресета):
    - 11.1. Уровень 1 — `ThemesOptions.themeFiles` в browser/node preset: pickThemeUrl‑подобная функция на per‑theme
      × per‑provider уровне; unit‑тесты на все формы (строка / объект / отсутствие); поддержка `data:`/`file://`.
    - 11.2. Уровень 2 — контракт `GranularThemeTokenSet` + `GranularThemeContribution.tokenDefinitions`; реестр
      `ThemeTokenRegistry` (`Map<themeName, { selector, tokens: Map }>`), построенный в порядке `options.providers[]`;
      генератор override‑CSS‑блока; слияние `ThemesOptions.tokenOverrides` поверх реестра; `strictTokens` +
      `UnknownTokenOverrideError`; скип `themes[name]` у провайдеров со структурной формой; dev‑warn для игнорируемых
      `tokenOverrides` у файловых провайдеров.
    - 11.3. Обновить порядок preflights в `preset.node.ts`:
      `tokensCss → baseCss → token‑override‑block → legacy themes → themeFiles override → component CSS →
      provider.unocss.preflights → options.preflights`.
12. Документация: README нового пакета (quick‑start, provider authoring, FAQ по layer/order/themes, раздел
    «Override тем: Уровень 1 vs Уровень 2»), CHANGELOG, migration guide.
13. CI/релиз: версии, provenance, changesets.

---

## 14. Риски и как их смягчаем

- **Разрыв кеша тем при переезде themeRegistry** → покрываем snapshot‑тестами итогового CSS до/после миграции на
  playground‑5.
- **Потеря rules из старого пресета при переходе на wind4** → фиксируем список использованных utility‑классов в
  granularity‑компонентах; что есть в wind4 — берём из wind4, что уникально — вносим в
  `granularityProvider.unocss.rules`.
- **Кросс‑провайдер safelist** (композит из extra‑granularity использует примитивы granularity) → решается единым
  реестром компонентов и рекурсивным резолвом (§7). Компонент декларирует только свои классы и чужие
  зависимости в `dependencies`; классы транзитивных deps подтянутся автоматически. Ручное дублирование
  классов в safelist композита — антипаттерн.
- **Breaking‑change для пользователей текущего `presetGranularityNode`** → оформляем как мажорный релиз
  `@feugene/granularity`; deprecated‑shim'ы намеренно не делаем (см. §10). Минимизируем трение за счёт подробного
  migration guide и одновременного перевода всех `apps/playground-*`.
