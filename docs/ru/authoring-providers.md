# Написание пакетов‑провайдеров

**Granular‑провайдер** — обычный npm‑пакет, который экспортирует объект
`GranularProvider` через хелперы `@feugene/unocss-preset-granular/contract`.
Приложение подхватывает его через `uno.config.ts` и тянет только те
компоненты/темы, которые реально использует.

> См. также: [Архитектура](./architecture.md),
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
    "@feugene/unocss-preset-granular": "^1",
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

  // Опционально: доп. директория исходников для UnoCSS‑scan, относительно config.ts.
  // По умолчанию './' — директория самого config.ts.
  // Используйте, если компонент лежит в нестандартной раскладке.
  sourceDir: './',
})
```

Заметки:

- **Первый аргумент** — `import.meta.url` самого `config.ts`. Пресет через
  него резолвит `cssFiles[i]` и `sourceDir` через `new URL(...,
  import.meta.url)`.
- Элементы `safelist` — `string` или `RegExp`.
- Держите `safelist` минимальным. Если приходится писать туда `p-5`,
  `text-lg` — скорее всего, компонент просто не сканируется (→
  [Сканирование компонентов](./component-scanning.md)).

## Определение провайдера: `granular-provider/index.ts`

```ts
import { defineGranularProvider } from '@feugene/unocss-preset-granular/contract'
import { buttonConfig } from '../components/MyButton/config'
import { iconConfig } from '../components/MyIcon/config'

export default defineGranularProvider({
  id: '@your-scope/your-package',
  contractVersion: 1,

  // URL корня ассетов пакета. Используется node‑слоем для
  // src/ ↔ dist/ fallback и для scan‑globs компонентов.
  //
  // ВАЖНО: литерал `new URL('..', import.meta.url)` rolldown заменяет на
  // data:-URL при build'е. Собирайте URL в рантайме:
  packageBaseUrl: `${import.meta.url.slice(0, import.meta.url.lastIndexOf('/', import.meta.url.lastIndexOf('/') - 1) + 1)}`,

  components: [buttonConfig, iconConfig],

  theme: {
    baseCssUrl:   new URL('../styles/base.css',   import.meta.url).href,
    tokensCssUrl: new URL('../styles/tokens.css', import.meta.url).href,
    themes: {
      light: new URL('../styles/themes/light.css', import.meta.url).href,
      dark:  new URL('../styles/themes/dark.css',  import.meta.url).href,
    },
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

**Критически важно** для библиотек, которые поставляют компоненты как Vue
SFC и хотят быть scannable. По умолчанию `rollup-plugin-vue` выкладывает
SFC‑чанки в плоский `dist/chunks/`, который находится вне scan‑директории
компонента. Scan globs пресета смотрят в директорию компонента — и реальные
классы (`p-5`) до итогового CSS не доходят.

Решение — маршрутизировать **SFC‑чанки в папку компонента**:

```ts
// packages/<your-package>/vite.config.ts
import { defineConfig } from 'vite'
import Vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

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
    rollupOptions: {
      external: ['vue', /^@feugene\//],
      output: {
        entryFileNames: '[name].js',
        // SFC‑чанки — внутрь папки компонента:
        chunkFileNames: (info) => {
          const m = [...info.moduleIds].find(id => id.endsWith('.vue'))
          if (m) {
            const name = m.split('/src/components/')[1]?.split('/')[0]
            if (name) return `components/${name}/chunks/[name]-[hash].js`
          }
          return 'chunks/[name]-[hash].js'
        },
      },
    },
  },
})
```

Без этого `dist/components/MyButton/index.js` — лишь re‑export, а реальный
шаблон (с `class="p-5"`) — в `dist/chunks/*.js` за пределами scan‑директории.

## Правила (сводка)

- `safelist` → **только свои** динамические классы компонента.
- `dependencies` → транзитивные компоненты (короткая, `providerId:Name`
  или объектная форма).
- `cssFiles` → component‑local CSS, всегда приезжает как preflight.
- `sourceDir` → переопределение scan‑директории исходников (нужно редко).
- `packageBaseUrl` → **директория** пакета, не конкретный модуль.
- При сборке Vite/rolldown — всегда runtime‑конкатенация `packageBaseUrl`:
  `new URL('..', import.meta.url)` превратится в `data:`‑URL.
- Донор cross‑provider зависимостей обязан быть в `peerDependencies`.

## Чек‑лист перед публикацией

- [ ] В `dist/` есть `granular-provider/index.js` (+ `node.js`, если есть).
- [ ] `dist/components/<Name>/index.js` существует для каждого компонента,
      а `dist/components/<Name>/chunks/*.js` содержат реальный SFC‑код.
- [ ] `package.json.exports` публикует все эти subpaths.
- [ ] `peerDependencies` содержит `@feugene/unocss-preset-granular`, `vue`
      и всех доноров из cross‑provider `dependencies`.
- [ ] В runtime‑коде нет ссылок на `data:`‑URL (проверка `packageBaseUrl`).
- [ ] Smoke‑тест: установить пакет в свежее приложение, добавить в
      `providers`, выбрать один компонент, `vite build`, проверить, что его
      классы есть в итоговом CSS без `safelist`.
