# Написание пакетов‑провайдеров

**Granular‑провайдер** — обычный npm‑пакет, который экспортирует объект
`GranularProvider` через хелперы `@feugene/unocss-preset-granular/contract`.
Приложение подхватывает его через `uno.config.ts` и тянет только те
компоненты/темы, которые реально использует.

> См. также: [Правила создания компонента](./component-authoring.md) —
> единый свод правил по созданию **одного** компонента внутри пакета‑провайдера,
> [Архитектура](./architecture.md),
> [Сканирование компонентов](./component-scanning.md).

## Раскладка пакета

Рекомендуемая (её используют `@feugene/simple-package`,
`@feugene/extra-simple-package`):

```
packages/<your-package>/
├─ src/
│  ├─ components/
│  │  ├─ MyButton/
│  │  │  ├─ MyButton.vue
│  │  │  ├─ config.ts        ← defineGranularComponent(...)
│  │  │  ├─ styles.css       ← component‑local CSS (опц.)
│  │  │  └─ index.ts         ← re‑export компонента
│  │  └─ MyIcon/
│  │     └─ ...
│  ├─ styles/
│  │  ├─ base.css
│  │  ├─ tokens.css
│  │  └─ themes/{light,dark}.css
│  └─ granular-provider/
│     ├─ index.ts            ← браузерный entry (default export = провайдер)
│     └─ node.ts             ← опц. node entry (tokenDefinitions и FS‑only хелперы)
├─ package.json              ← должен публиковать granular-provider пути
└─ vite.config.ts            ← библиотечная сборка; см. "Рецепт сборки" ниже
```

### `package.json` exports

```jsonc
{
  "name": "@your-scope/your-package",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/types/index.d.ts",
      "default": "./dist/index.js"
    },
    "./granular-provider": {
      "types": "./dist/types/granular-provider/index.d.ts",
      "default": "./dist/granular-provider/index.js"
    },
    "./granular-provider/node": {
      "types": "./dist/types/granular-provider/node.d.ts",
      "default": "./dist/granular-provider/node.js"
    },
    "./components/*": {
      "types": "./dist/types/components/*/index.d.ts",
      "default": "./dist/components/*/index.js"
    }
  },
  "peerDependencies": {
    "@feugene/unocss-preset-granular": "^0.7.0",
    "vue": "^3"
  }
}
```

Провайдер‑**композит** (тот, кто декларирует `dependencies` на компоненты
другого провайдера) обязан добавить донора в `peerDependencies` — ставит
его приложение.

## Определение компонента: `config.ts`

```ts
// packages/<your-package>/src/components/MyButton/config.ts
import { defineGranularComponent } from '@feugene/unocss-preset-granular/contract'

export const buttonConfig = defineGranularComponent(import.meta.url, {
  name: 'MyButton',

  // ТОЛЬКО классы, которые нельзя извлечь статически из шаблона
  // (динамика, computed, template-literal, attr(...)). Статику UnoCSS
  // подхватит через content.filesystem — не дублируйте её здесь.
  safelist: [
    /^my-button--/,           // regex разрешён
    'my-button--disabled',
  ],

  // CSS, который идёт вместе с компонентом и всегда должен попадать в
  // итоговый CSS как preflight (независимо от использования шаблона).
  cssFiles: ['./styles.css'],

  dependencies: [
    // тот же провайдер, короткая форма:
    'MyIcon',

    // другой провайдер, квалифицированная форма:
    '@feugene/simple-package:XTestStyled',

    // объектная форма — несколько имён из одного провайдера:
    { provider: '@feugene/simple-package', components: ['XTest1', 'XTestStyled'] },
  ],

})
```

Заметки:

- **Первый аргумент** — `import.meta.url` самого `config.ts`. Пресет через
  него резолвит `cssFiles[i]` через `new URL(..., import.meta.url)`.
- Элементы `safelist` — `string` или `RegExp`.
- Держите `safelist` минимальным. Если приходится писать туда `p-5`,
  `text-lg` — скорее всего, компонент просто не сканируется (→
  [Сканирование компонентов](./component-scanning.md)).

## Определение провайдера: `granular-provider/index.ts`

```ts
import { defineGranularProvider, resolvePackageBaseUrl } from '@feugene/unocss-preset-granular/contract'
import { buttonConfig } from '../components/MyButton/config'
import { iconConfig } from '../components/MyIcon/config'

export default defineGranularProvider({
  id: '@your-scope/your-package',
  contractVersion: 1,

  // URL корня ассетов пакета. От него node‑слой резолвит
  // `cssFileAssetNames` (fallback для cssFiles) и scan‑директории
  // `components/<Name>/` — значит он должен указывать на корень
  // ИМЕННО ЭТОЙ раскладки, будь то src/ или dist/.
  //
  // `resolvePackageBaseUrl(importMetaUrl, levelsUp = 1)` поднимается на одну
  // директорию от вызывающего модуля. Писать `new URL('..', import.meta.url)`
  // НЕЛЬЗЯ: rolldown распознаёт этот литерал и заменяет на data:-URL при
  // сборке — скан после этого молча схлопывается в ничто.
  packageBaseUrl: resolvePackageBaseUrl(import.meta.url),

  components: [buttonConfig, iconConfig],

  theme: {
    baseCssUrl:   new URL('../styles/base.css',   import.meta.url).href,
    tokensCssUrl: new URL('../styles/tokens.css', import.meta.url).href,
    themes: {
      light: new URL('../styles/themes/light.css', import.meta.url).href,
      dark:  new URL('../styles/themes/dark.css',  import.meta.url).href,
    },
    // Активируются, если приложение не задало `themes.names`. Объявляй
    // только реально поставляемые темы — см. themes-and-tokens.md.
    defaultThemes: ['light'],
  },

  unocss: {
    // опционально: rules / variants / preflights, нужные компонентам пакета
    // rules: [[/^my-grad$/, () => ({ 'background-image': '...' })]],
  },
})
```

Опциональный node entry (`granular-provider/node.ts`) — см.
[Темы и токены → `tokenDefinitionsFromCss*`](./themes-and-tokens.md).

## Рецепт Vite‑сборки — `chunkFileNames`

> ⚠️ **Относится только к пакетам‑провайдерам**, не к конечным приложениям.
> Приложения потребляют уже собранный `dist/` пакета и никакой собственной
> настройки `chunkFileNames` не требуют.

**Критически важно** для библиотек, которые поставляют компоненты как Vue
SFC и хотят быть scannable. По умолчанию `@vitejs/plugin-vue` выкладывает
SFC‑чанки в плоский `dist/chunks/`, который находится вне scan‑директории
компонента. Scan globs пресета смотрят в директорию компонента — и реальные
классы (`p-5`) до итогового CSS не доходят.

Решение — маршрутизировать **SFC‑чанки в папку компонента**. Логика
одинакова для всех провайдеров, поэтому пресет экспортирует готовый
хелпер `granularChunkFileNames` из subpath `./vite`:

```ts
// packages/<your-package>/vite.config.ts
import { defineConfig } from 'vite'
import Vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'
import { granularAssetFileNames, granularChunkFileNames } from '@feugene/unocss-preset-granular/vite'

export default defineConfig({
  plugins: [Vue()],
  build: {
    lib: {
      entry: {
        'index':                          resolve(__dirname, 'src/index.ts'),
        'granular-provider/index':        resolve(__dirname, 'src/granular-provider/index.ts'),
        'granular-provider/node':         resolve(__dirname, 'src/granular-provider/node.ts'),
        'components/MyButton/index':      resolve(__dirname, 'src/components/MyButton/index.ts'),
        'components/MyIcon/index':        resolve(__dirname, 'src/components/MyIcon/index.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: { // или rolldownOptions, если Vite использует rolldown
      external: ['vue', /^@feugene\//],
      output: {
        entryFileNames: '[name].js',
        // SFC‑чанки компонентов → `components/<Name>/chunks/`,
        // остальное остаётся во flat `chunks/`.
        chunkFileNames: granularChunkFileNames(),
        // CSS компонента → `components/<Name>/styles.css`: это же значение
        // `defineGranularComponent` пишет в `styleAssetFileName`, и по нему
        // node‑слой ищет CSS, когда пакет опубликован без исходников.
        // Нужен `build.cssCodeSplit: true`, иначе на выходе будет один
        // общий CSS пакета, а не по файлу на компонент.
        assetFileNames: granularAssetFileNames({
          components: ['MyButton', 'MyIcon'],
        }),
      },
    },
  },
})
```

Без этого `dist/components/MyButton/index.js` — лишь re‑export, а реальный
шаблон (с `class="p-5"`) — в `dist/chunks/*.js` за пределами scan‑директории.

### Размещение задекларированного CSS в `dist`

`assetFileNames` закрывает тот CSS, который **эмитит бандлер** (скомпилированные
стили SFC компонента). До CSS, который конфиг лишь *декларирует*, ему дела нет —
это `tokenDefinitionsRef`, записанный строкой, и `cssFiles`. У них в дескрипторе
есть `assetName`, и node‑слой падает на него, когда пакет опубликован только с
`dist/`, — но положить туда файл некому, и потребитель получает `ENOENT`.

`granularCssAssetsPlugin` закрывает этот разрыв. План он строит из самих
дескрипторов — для каждой ссылки копирует исходник ровно в тот `assetName`,
который проставил `define*`‑хелпер, — поэтому разъехаться с контрактом не может:

```ts
import { granularCssAssetsPlugin } from '@feugene/unocss-preset-granular/vite'
import { myButtonConfig } from './src/components/MyButton/config'

export default defineConfig({
  plugins: [
    vue(),
    granularCssAssetsPlugin({ components: [myButtonConfig] }),
    // либо разом по всему провайдеру (его темы + все компоненты):
    // granularCssAssetsPlugin({ providers: [myProvider] }),
  ],
})
```

Ссылка с отсутствующим исходником роняет сборку (`GranularCssAssetError`);
смягчается через `onMissing: 'warn'`. Ссылки, которые бандлер уже вшил
`data:`‑URL, пропускаются — копировать там нечего.

Про одну асимметрию стоит знать: `defineGranularProvider` — identity‑функция,
поэтому у package‑wide записей `theme.tokenDefinitionsRef` `assetName` **нет**.
Плагин про них сообщает, а не пропускает молча, — такие ссылки объявляйте
в форме `new URL(..., import.meta.url)`.

### Опции `granularChunkFileNames`

Хелпер — чистая функция, без зависимостей на Vite/rolldown/node, и по
умолчанию рассчитан на стандартную раскладку
`src/components/<Name>/<Name>.vue`. Если ваша раскладка отличается,
можно переопределить:

```ts
granularChunkFileNames({
  // regex, ловящий id модулей, относящихся к компоненту; группа 1 —
  // имя директории компонента
  componentModuleRegex: /\/src\/ui\/([^/]+)\/[^/]+\.vue(?:$|\?)/,
  // паттерн для component‑чанков; `<name>` подменяется на имя папки
  componentChunkPattern: 'ui/<name>/chunks/[name]-[hash].js',
  // паттерн для всех остальных (shared) чанков
  fallbackChunkPattern: 'chunks/[name]-[hash].js',
})
```

⚠️ Не кладите сюда non‑component чанки (например, `granular-provider` или
общие config‑чанки) — если они «уедут» в папку компонента, сломается
runtime‑резолв `packageBaseUrl`. Хелпер триггерит перенос **только** если
в модулях чанка есть `*.vue` файл конкретного компонента.

### Группы компонентов и shared SFC

Когда два или более entry‑компонентов импортируют один и тот же SFC,
Rollup дедуплицирует его в shared‑чанк. По умолчанию такой чанк
отправляется в плоский `dist/chunks/` и **не сканируется**. Чтобы его
утилитарные классы попадали в итоговый CSS, кладите такие SFC в
`src/components/<group>/shared/<File>.vue` и декларируйте одинаковый
`group` у всех entry‑компонентов группы:

```ts
// src/components/transaction-details/FtExpenseModal/config.ts
defineGranularComponent(import.meta.url, {
  name: 'FtExpenseModal',
  group: 'transaction-details',
  safelist: [],
})

// src/components/transaction-details/shared/TransactionModalHeader.vue
// — импортируется FtExpenseModal, FtIncomeModal, FtTransferModal
```

`granularChunkFileNames()` распознаёт раскладку `<group>/shared/<File>.vue`
и роутит shared‑чанки в `dist/groups/<group>/shared/[name]-[hash].js`. На
стороне приложения пресет, видя выбранный компонент с
`group: '<group>'`, дополнительно сканирует
`<packageBaseUrl>/groups/<group>/shared/` (один раз на группу — благодаря
дедупу). См. [component-scanning → Группы компонентов](./component-scanning.md#группы-компонентов-shared-sfc-между-entry-компонентами).

Можно переопределить regex/pattern для нестандартной раскладки:

```ts
granularChunkFileNames({
  sharedModuleRegex: /\/src\/widgets\/(.+)\/_shared\/[^/]+\.vue(?:$|\?)/,
  sharedChunkPattern: 'groups/<group>/shared/[name]-[hash].js',
})
```

## Чего НЕ делать

Шесть ошибок, которые собираются без единой жалобы и ломают только рантайм —
или только опубликованный пакет:

**1. Импорт `/node` из `config.ts` компонента.** Этот файл попадает в
`granular-provider/index.ts` — то есть в **браузерный** экспорт, — и тянет
`node:fs` в клиентский бандл. Сборка при этом не падает.

Если компоненту нужны токены, вычитанные из CSS, **объявляйте ссылку вместо
чтения файла**: `tokenDefinitionsRef` — это данные, а разворачивает их node‑слой
пресета при загрузке конфига приложения:

```ts
// components/XTokenized/config.ts — ни импорта /node, ни второго файла
import { defineGranularComponent } from '@feugene/unocss-preset-granular/contract'

export const xTokenizedConfig = defineGranularComponent(import.meta.url, {
  name: 'XTokenized',
  tokenDefinitionsRef: {
    // Литеральный `new URL(..., import.meta.url)` — то, на что реагирует
    // бандлер, эмитя (или инлайня) CSS. См. «Две формы ссылки» ниже.
    light: new URL('./themes/light.css', import.meta.url).href,
    dark: { url: new URL('./themes/dark.css', import.meta.url).href, as: '.dark' },
  },
})
```

Обе формы ссылки и что с ними делает node‑слой — в
[Темы и токены →
`tokenDefinitionsRef`](./themes-and-tokens.md#tokendefinitionsref--ссылки-вместо-обращения-к-fs).

<details>
<summary>До <code>tokenDefinitionsRef</code>: обходной путь с двумя файлами</summary>

Раньше конфиг приходилось делить надвое — способ остаётся рабочим, если нужны
произвольные вычисления на стороне node, а не просто разбор CSS:

```ts
// components/XTokenized/config.ts — только литералы, browser‑safe
import { defineGranularComponent } from '@feugene/unocss-preset-granular/contract'

export const xTokenizedConfig = defineGranularComponent(import.meta.url, {
  name: 'XTokenized',
})
```

```ts
// components/XTokenized/config.node.ts — можно читать файлы
import { tokenDefinitionsFromCssSync } from '@feugene/unocss-preset-granular/node'
import { xTokenizedConfig } from './config'

const lightUrl = new URL('./themes/light.css', import.meta.url).href

export const xTokenizedNodeConfig = {
  ...xTokenizedConfig,
  tokenDefinitions: {
    light: tokenDefinitionsFromCssSync(lightUrl, { selector: ':root' }),
  },
}
```

Дальше — фабрика в браузерном entry, переиспользуемая в node‑entry, чтобы
варианты не разъехались по `id` и `packageBaseUrl`:

```ts
// granular-provider/index.ts
export const PACKAGE_BASE_URL = resolvePackageBaseUrl(import.meta.url)
export const browserComponents = [xTokenizedConfig /* , ... */]

export function createMyProvider(components: typeof browserComponents) {
  return defineGranularProvider({
    id: '@your-scope/your-package',
    contractVersion: 1,
    packageBaseUrl: PACKAGE_BASE_URL,
    components,
  })
}

export default createMyProvider(browserComponents)
```

```ts
// granular-provider/node.ts
import { xTokenizedNodeConfig } from '../components/XTokenized/config.node'
import { browserComponents, createMyProvider } from './index'

export default createMyProvider(
  browserComponents.map(c => (c.name === 'XTokenized' ? xTokenizedNodeConfig : c)),
)
```

</details>

**2. Импорт `/node`‑entry донора из своего браузерного entry.** Та же утечка
уровнем выше: `granular-provider/index.ts` должен импортировать
`@your-donor/pkg/granular-provider`, а `@your-donor/pkg/granular-provider/node` —
только `granular-provider/node.ts`.

Проверять надо по собранному бандлу, а не по исходникам:

```bash
grep -rn "unocss-preset-granular/node" dist/granular-provider.js dist/chunks/*.js
# должно быть пусто
```

**3. Ключи токенов с `--`.** `tokens: { brand: '#fff' }`, а не
`{ '--brand': '#fff' }` — префикс дописывает генератор, иначе получите
`----brand`.

**4. Тема в `defaultThemes`, которую вы не поставляете.** `defaultThemes`
активирует тему не для *ваших* компонентов, а для **всей сборки**. Объявите
`dark`, не отдав ни `themes.dark`, ни `tokenDefinitions.dark`, — и компоненты
всех остальных провайдеров поедут под темой, токенов для которой им никто не
дал. Объявляйте только то, что реально поставляете (остальное `granular doctor`
показывает как `default-theme-without-source`).

**5. Разошедшиеся раскладки `styleAssetFileName` и `cssFileAssetNames`.**
Пресет читает только `cssFileAssetNames`, а `assetFileNames` бандлера идёт
только за `styleAssetFileName`. Пока вы разрабатываете в монорепе, CSS
находится по пути из `cssFiles` и fallback не срабатывает вовсе — расхождение
может жить сколько угодно. Ломается оно в **опубликованном** пакете, где `src/`
уже нет и fallback остаётся единственным путём, — и ломается как `ENOENT` в
чужой сборке. Эмитьте оба значения через `defineGranularComponent` и не пишите
их руками.

**6. Чужие классы в собственном `safelist`.** Выглядит рабочим: классы в CSS
появляются. Но `dependencies` подтягивает и `cssFiles` чужого компонента, и его
скан-директорию, а запись в `safelist` — ни то ни другое: утилитарные классы вы
получите, а собственную таблицу стилей компонента потеряете. Объявляйте связь
через `dependencies` — транзитивные `safelist` и CSS пресет соберёт сам.

**7. Расхождение `dependencies` с тем, что вы отгружаете.** Ваш бандлер
`dependencies` не читает вовсе, поэтому забытое ребро не стоит вам ничего на
сборке и стоит вашему потребителю бесцветного вложенного компонента.
Запускайте `granular doctor` — он сверяет объявленный граф с импортами,
реально присутствующими в сборке, и показывает каждый пропуск как
`undeclared-dependency`. Обязательно **с `components: 'all'`**: источниками
служат только выбранные компоненты, и на конфигурации приложения вы проверите
лишь замыкание его селекции, а не свой пакет. В CI — с `--strict`. Границы
применимости проверки перечислены в [cli.md](./cli.md).

## Правила (сводка)

- `safelist` → **только свои** динамические классы компонента.
- `dependencies` → компоненты, которые ваш компонент **реально импортирует**
  в собранном коде (короткая, `providerId:Name` или объектная форма).
- `cssFiles` → component‑local CSS, всегда приезжает как preflight.
- `packageBaseUrl` → **директория** пакета, не конкретный модуль.
- При сборке Vite/rolldown — всегда runtime‑конкатенация `packageBaseUrl`:
  `new URL('..', import.meta.url)` превратится в `data:`‑URL.
- Донор cross‑provider зависимостей обязан быть в `peerDependencies`.

## Чек‑лист перед публикацией

- [ ] В `dist/` есть `granular-provider/index.js` (+ `node.js`, если есть).
- [ ] `dist/components/<Name>/index.js` существует для каждого компонента,
      а `dist/components/<Name>/chunks/*.js` содержат реальный SFC‑код.
- [ ] У каждой строковой записи `tokenDefinitionsRef` / `cssFiles` есть реальный
      файл по её `assetName` в `dist` (для этого и нужен `granularCssAssetsPlugin`).
- [ ] `package.json.exports` публикует все эти subpaths.
- [ ] `peerDependencies` содержит `@feugene/unocss-preset-granular`, `vue`
      и всех доноров из cross‑provider `dependencies`.
- [ ] В runtime‑коде нет ссылок на `data:`‑URL (проверка `packageBaseUrl`).
- [ ] Smoke‑тест: установить пакет в свежее приложение, добавить в
      `providers`, выбрать один компонент, `vite build`, проверить, что его
      классы есть в итоговом CSS без `safelist`.
