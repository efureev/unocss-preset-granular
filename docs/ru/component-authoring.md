# Правила создания компонента в пакете‑провайдере

Этот документ — **единый свод правил**, как добавить новый компонент в
granular‑пакет (например, `@feugene/simple-package`), чтобы он корректно
подхватывался пресетом `@feugene/unocss-preset-granular`: сканировался,
получал свои стили, попадал в `safelist` только по необходимости и
публиковался как отдельный `exports`‑subpath.

> Связанные документы:
> - [Написание пакетов‑провайдеров](./authoring-providers.md) — общий
>   контракт `GranularProvider`, `granular-provider/index.ts`,
>   `packageBaseUrl`, рецепт `chunkFileNames`.
> - [Сканирование компонентов](./component-scanning.md) — почему
>   `granularContent(...)` обязателен и как пресет находит классы.
> - [Темы и токены](./themes-and-tokens.md) — `base.css`, `tokens.css`,
>   per‑theme CSS.
> - [Установка и подключение](./installation.md) — в какие секции
>   `package.json` класть пресет/доноров.

## 1. Раскладка директории компонента

**Обязательная** структура для каждого компонента:

```
packages/<your-package>/src/components/<ComponentName>/
├─ <ComponentName>.vue      ← SFC (шаблон + <script setup lang="ts">)
├─ config.ts                ← defineGranularComponent(...)
├─ index.ts                 ← публичный re‑export компонента
├─ styles.css               ← component‑local CSS (опционально)
└─ <internal>.ts            ← приватные утилиты компонента (опц.)
```

Правила:

- **Имя директории === имя компонента** (PascalCase). Пресет строит
  scan‑globs и dist‑пути по имени директории.
- **Имя `.vue` файла === имя директории**. Это нужно и для DX, и для
  рецепта `chunkFileNames` (см. [authoring-providers.md](./authoring-providers.md#рецепт-vite-сборки--chunkfilenames)).
- Все внутренние модули компонента (`dsStyles.ts`, утилиты, partial
  SFC) **лежат внутри** папки компонента — только так они попадут в
  scan‑директорию UnoCSS.
- Общие утилиты на несколько компонентов (`src/utils/classTokens.ts`
  и т.п.) допустимы, но **не сканируются** как часть компонента —
  статические классы из них в итоговый CSS **не попадут** (их придётся
  добавить в `safelist` явно). Держите такие хелперы в `src/utils/`,
  не в `src/components/`, чтобы scan‑директория компонента оставалась
  чистой.

## 2. `config.ts` — `defineGranularComponent`

Каждый компонент обязан экспортировать конфиг через
`defineGranularComponent(import.meta.url, {...})` из
`@feugene/unocss-preset-granular/contract`.

```ts
// src/components/MyButton/config.ts
import { defineGranularComponent } from '@feugene/unocss-preset-granular/contract'

export const myButtonConfig = defineGranularComponent(import.meta.url, {
  // 1. Имя компонента (PascalCase, === имя директории)
  name: 'MyButton',

  // 2. Транзитивные зависимости (короткая / qualified / объектная форма)
  dependencies: [
    'MyIcon',                                   // свой провайдер
    '@feugene/simple-package:XTestStyled',      // другой провайдер
    { provider: '@feugene/simple-package', components: ['XTest1'] },
  ],

  // 3. ТОЛЬКО динамические классы, которые нельзя извлечь статически
  //    из шаблона (computed, template-literal, attr, runtime bindings).
  //    Статику подхватит content.filesystem.
  safelist: [
    /^my-button--/,
    'my-button--disabled',
  ],

  // 4. CSS компонента — всегда едет в итоговый CSS как preflight
  cssFiles: ['./styles.css'],

  // 5. Переопределение scan‑директории (нужно крайне редко)
  sourceDir: './',
})
```

### Правила заполнения полей

| Поле           | Кратко                                                                    |
|----------------|---------------------------------------------------------------------------|
| `name`         | PascalCase, строго === имя директории.                                    |
| `dependencies` | Только компоненты, от которых **шаблон** реально зависит.                 |
| `safelist`     | `string \| RegExp`. Только то, что **нельзя** извлечь статически.         |
| `cssFiles`     | Пути относительно `config.ts`. Приезжают в UnoCSS как `preflights`.       |
| `sourceDir`    | По умолчанию `'./'` — директория `config.ts`. Не трогайте без причины.    |

### Критично про `safelist`

- ❌ Не добавляйте сюда `p-5`, `text-lg`, `flex` — это **статика**, её
  UnoCSS извлечёт сам через `content.filesystem`.
- ✅ Добавляйте: классы, собранные из `computed`, `` `foo-${props.size}` ``,
  `v-bind:class` с ветвлениями по условию, классы, построенные в
  JS‑модулях вне папки компонента.
- Если приходится много писать в `safelist` — скорее всего, сломана
  раскладка или scan‑директория (→
  [component-scanning.md](./component-scanning.md)).

### `import.meta.url` — обязателен

Первый аргумент `defineGranularComponent` — `import.meta.url` самого
`config.ts`. Через него пресет резолвит `cssFiles[i]` и `sourceDir` как
`new URL(path, import.meta.url)`. Не подменяйте его и не выносите
`config.ts` из папки компонента.

## 3. SFC: `<ComponentName>.vue`

```vue
<script setup lang="ts">
// Типизированные props/emits, composables. Ничего связанного с
// рантайм‑регистрацией в пресете делать не нужно.
defineProps<{ disabled?: boolean }>()
</script>

<template>
  <!-- Статика класса — лучший вариант, UnoCSS найдёт её через scan -->
  <button class="px-4 py-2 rounded bg-primary text-white">
    <slot />
  </button>
</template>

<style scoped>
/* scoped CSS компонента (не safelist‑зависимый) */
</style>
```

Рекомендации:

- Предпочитайте **статические** `class="..."` — они бесплатны (сканер
  UnoCSS + `content.filesystem`).
- Динамику (`:class`) объявляйте максимально плоско; любые классы,
  которые не попадают в статический литерал шаблона, попадают в
  `safelist` из `config.ts`.
- CSS, который должен ехать **всегда** (reset/layout компонента),
  выносите в `styles.css` и подключайте через `cssFiles`. Такой CSS
  приезжает как UnoCSS `preflight` и **не зависит** от scan‑результата.

## 4. `index.ts` — публичный re‑export

Строго два экспорта — default и именованный:

```ts
// src/components/MyButton/index.ts
export { default } from './MyButton.vue'
export { default as MyButton } from './MyButton.vue'
```

Это даёт приложению одинаково писать:

```ts
import MyButton from '@your-scope/your-package/components/MyButton'
// или
import { MyButton } from '@your-scope/your-package'
```

## 5. Регистрация компонента в пакете и провайдере

После создания папки компонента нужно подключить его в **трёх** местах:

### 5.1. Корневой `src/index.ts` пакета

```ts
export * from './components/MyButton'
export * from './components/MyIcon'
```

### 5.2. `src/granular-provider/index.ts`

```ts
import { defineGranularProvider } from '@feugene/unocss-preset-granular/contract'
import { myButtonConfig } from '../components/MyButton/config'
import { myIconConfig }   from '../components/MyIcon/config'

export default defineGranularProvider({
  id: '@your-scope/your-package',
  contractVersion: 1,
  packageBaseUrl: /* runtime‑concat, см. authoring-providers.md */,
  components: [myButtonConfig, myIconConfig],
  // theme: { ... }, unocss: { ... }
})
```

Каждый новый компонент обязан быть в массиве `components`, иначе пресет
его «не видит», даже если приложение указало его в `components: [...]`
у `uno.config.ts`.

### 5.3. `package.json → exports` и Vite `build.lib.entry`

`package.json`:

```jsonc
{
  "exports": {
    // ...
    "./components/MyButton": {
      "types": "./dist/types/src/components/MyButton/index.d.ts",
      "import": "./dist/components/MyButton/index.js"
    }
  }
}
```

`vite.config.ts`:

```ts
build: {
  lib: {
    entry: {
      // ...
      'components/MyButton/index': resolve(__dirname, 'src/components/MyButton/index.ts'),
    },
    formats: ['es'],
  },
  rollupOptions: {
    output: {
      // см. authoring-providers.md → chunkFileNames
    },
  },
}
```

Без этого dist не будет содержать `dist/components/MyButton/index.js`,
а scan‑директория пресета окажется пустой.

## 6. CSS компонента (`styles.css`)

- Пути в `cssFiles` — **относительно `config.ts`**.
- Не используйте в этом CSS Uno‑утилиты через `@apply` с классами,
  которых нет в итоговой сборке (они резолвятся через тот же UnoCSS,
  но при дефектах scan могут отсутствовать) — см.
  [troubleshooting.md](./troubleshooting.md).
- Для токенов/тем используйте переменные из `base.css` / `tokens.css`
  провайдера, а не хардкод — см.
  [themes-and-tokens.md](./themes-and-tokens.md).
- В `package.json` пакета должно быть `"sideEffects": ["**/*.css"]` —
  иначе bundler приложения вырежет CSS компонента.

## 7. Зависимости между компонентами

- Внутри своего пакета — **короткая** форма: `'MyIcon'`.
- Компонент из другого пакета — **qualified**: `'@feugene/simple-package:XTest1'`.
- Несколько компонентов из одного донора — **объектная** форма:
  `{ provider: '@feugene/simple-package', components: ['XTest1', 'XTestStyled'] }`.
- Если ваш компонент тянет компонент из другого пакета → пакет‑донор
  обязан быть в `peerDependencies` (см.
  [installation.md](./installation.md)).

## 8. Чек‑лист перед PR / релизом

- [ ] Создана папка `src/components/<Name>/` с файлами
      `<Name>.vue`, `config.ts`, `index.ts`.
- [ ] `config.ts` использует `defineGranularComponent(import.meta.url, ...)`,
      `name` === имя директории.
- [ ] `safelist` содержит **только** динамические классы; статика
      живёт в шаблоне.
- [ ] `cssFiles` (если есть) — пути относительно `config.ts`,
      файлы существуют.
- [ ] `dependencies` корректны (короткая / qualified / объектная форма).
- [ ] Компонент реэкспортирован из `src/index.ts`.
- [ ] Конфиг компонента добавлен в `components: [...]`
      провайдера (`src/granular-provider/index.ts`).
- [ ] `package.json.exports` публикует `./components/<Name>`.
- [ ] Добавлен entry в `vite.config.ts → build.lib.entry`.
- [ ] `sideEffects` в `package.json` сохраняет CSS.
- [ ] `vite build` → `dist/components/<Name>/index.js` существует,
      SFC‑чанки лежат в `dist/components/<Name>/chunks/*.js` (а не в
      плоском `dist/chunks/*`).
- [ ] Smoke‑тест в тестовом приложении: выбрать **только** этот
      компонент в `components` пресета, `vite build` — классы из его
      шаблона попадают в CSS **без** добавления в `safelist`.
