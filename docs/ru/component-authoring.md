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

  // 6. Публикация CSS‑токенов темы на уровне КОМПОНЕНТА (опц.)
  //    См. §7 — «Токены темы на уровне компонента».
  tokenDefinitions: {
    light: {
      selector: ':root',
      tokens: { '--my-button-bg': '#fff', '--my-button-fg': '#111' },
    },
    dark: {
      selector: '.dark',
      tokens: { '--my-button-bg': '#111', '--my-button-fg': '#fff' },
    },
  },
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
| `tokenDefinitions` | `Record<themeName, { selector, tokens }>`. CSS‑токены темы от компонента. |

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

### 6.1. Свои стили внутри SFC — `<style>` и `@apply`

Помимо отдельного `styles.css`, стили компонента можно писать прямо в
`<style>` внутри `.vue`‑файла. Это удобно для «локальных» правил, которые
логически принадлежат только этому компоненту.

Пример — `packages/simple-package/src/components/XTest1/XTest1.vue`:

```vue
<template>
  <div class=":uno: border border-[var(--brd)] p-4 x-sp-test">
    <slot/>
  </div>
</template>

<style>
.x-sp-test {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  align-items: stretch;

  @apply text-lg font-bold text-red-500;
}
</style>
```

Ключевые правила:

- **`@apply` работает только при подключённом `transformerDirectives()`**
  в `uno.config.ts` приложения. Без него директива `@apply` будет
  оставлена как есть и «посыплется» в рантайме.
  См. `apps/app-1/uno.config.ts`:

  ```ts
  import { transformerDirectives } from 'unocss'

  export default defineConfig({
    transformers: [transformerDirectives(), transformerCompileClass()],
  })
  ```

- **Классы, перечисленные в `@apply`, должны быть известны UnoCSS.**
  Токены/утилиты резолвит сам UnoCSS сборки приложения; поэтому
  любые кастомные правила/пресеты должны быть в `uno.config.ts`
  приложения, а не только в пакете.
- **`<style>` vs `<style scoped>`.** При `scoped` Vue добавляет к
  селекторам атрибут `[data-v-xxxx]`; такая CSS всё равно попадает в
  общий ассет компонента и подхватывается через libInjectCss.
- **CSS из `<style>` в multi‑entry lib‑сборке требует
  `vite-plugin-lib-inject-css` и `build.cssCodeSplit: true`**
  в `vite.config.ts` пакета. Иначе Vite склеит CSS в единый ассет,
  но не эмиттит `import './...css'` ни в один sub‑entry, и
  потребитель, импортирующий `@your-pkg/components/MyButton`, не
  получит стили. См. `packages/simple-package/vite.config.ts`:

  ```ts
  import { libInjectCss } from 'vite-plugin-lib-inject-css'

  export default defineConfig({
    plugins: [vue(), libInjectCss()],
    build: {
      cssCodeSplit: true,
      lib: { /* multi-entry */ },
    },
  })
  ```

  После сборки в `dist/components/<Name>/chunks/<Name>-*.js`
  автоматически появится `import '../../../<Name>.css'`, и при
  sub‑path импорте компонента бандлер приложения затянет именно его
  CSS (включая правила с `@apply`).

- **Альтернатива — `cssFiles`.** Если нужны стили, которые едут
  **всегда**, независимо от scan‑результата (например, reset/layout
  компонента), держите их в `./styles.css` и подключайте через
  `cssFiles` в `config.ts` — они приезжают в UnoCSS как `preflights`,
  не зависят от libInjectCss и применяются даже без импорта SFC.

### 6.2. Компиляция классов через `transformerCompileClass` (`:uno:`)

`transformerCompileClass()` (из `unocss`) сжимает длинный список Uno‑утилит
в **один короткий класс** на этапе сборки. Это уменьшает размер HTML/JS
и делает разметку чище.

Активируется префиксом в строке класса — по умолчанию `:uno:`:

```vue
<template>
  <div class=":uno: border border-[var(--brd)] p-4 x-sp-test">
    <slot/>
  </div>
</template>
```

Что происходит при сборке `apps/app-1`:

1. UnoCSS видит в исходниках `:uno: border border-[var(--brd)] p-4 x-sp-test`.
2. `transformerCompileClass` собирает все утилиты до следующего
   не‑utility токена, удаляет маркер `:uno:` и заменяет их
   на сгенерированный класс, например `uno-91fns9`.
3. В итоговом JS‑чанке (`apps/app-1/dist/assets/spkg-*.js`) у шаблона
   остаётся только короткий класс:

   ```js
   // фрагмент скомпилированного кода
   createElementBlock("div", { class: "uno-91fns9 x-sp-test" }, ...)
   ```

4. В CSS‑ассет приложения (`apps/app-1/dist/assets/app-styles-*.css`)
   попадает правило:

   ```css
   .uno-91fns9 { border-width: 1px; padding: 1rem; border-color: var(--brd); }
   ```

Правила применения:

- Трансформер обязательно подключается **в `uno.config.ts` приложения**,
  а не в пакете — компиляция делается во время сборки приложения,
  когда известен полный конфиг UnoCSS:

  ```ts
  import { transformerCompileClass } from 'unocss'

  export default defineConfig({
    transformers: [transformerDirectives(), transformerCompileClass()],
  })
  ```

- **Маркер должен быть первым токеном** в строке класса: `":uno: px-4 py-2"`.
  Всё, что стоит до маркера или после не‑utility токена, трансформер
  не трогает (в примере `x-sp-test` остаётся как есть).
- **Динамические классы не компилируются.** Трансформер работает по
  статическому литералу шаблона; для `:class="..."` используйте обычные
  Uno‑утилиты или `safelist` в `config.ts`.
- **DevTools и дифф‑ридинг.** Имя класса (`uno-91fns9`) детерминировано
  от набора утилит, но нечитаемо — на dev‑этапе можно отключить
  трансформер или передать ему опцию `trigger`/`classPrefix`, чтобы
  отличать разные блоки. См. документацию `transformerCompileClass`.
- **Сочетается со `<style>` и `@apply`.** В примере `XTest1.vue`:
  утилиты из `:uno:` компилируются в `uno-91fns9`, а правила из
  `<style>` (включая `@apply text-lg font-bold text-red-500`)
  обрабатываются `transformerDirectives` и едут через
  libInjectCss‑ассет пакета.

## 7. Токены темы на уровне компонента (`tokenDefinitions`)

Компонент может **сам публиковать свои CSS‑токены для тем** — по аналогии с
`theme.tokenDefinitions` провайдера, но точечно. Это удобно для «инкапсулированных»
компонентов, чьи цвета/радиусы/отступы не нужно выносить в общий набор токенов
провайдера.

```ts
// src/components/XTokenized/config.ts
export const xTokenizedConfig = defineGranularComponent(import.meta.url, {
  name: 'XTokenized',
  cssFiles: ['./XTokenized.css'],
  tokenDefinitions: {
    light: {
      selector: ':root',
      tokens: { 'x-tokenized': '#2563eb' }, // --x-tokenized: #2563eb;
    },
    dark: {
      selector: '.dark',
      tokens: { 'x-tokenized': '#93c5fd' },
    },
  },
})
```

### Как это работает

1. Пресет обходит выбранные компоненты (post‑order `resolveSelection`, т.е. в порядке
   топологической сортировки зависимостей) и мёржит их `tokenDefinitions` в
   общий реестр токенов тем.
2. Выгружаются **только активные** темы — те, что перечислены в `themes.names`
   приложения. Если приложение задало только `['light']`, токены блока `dark`
   будут проигнорированы, блок `:root { --x-tokenized: #2563eb }` попадёт в CSS,
   `.dark { ... }` — нет.
3. Если тема в `themes.names` есть, но ни один провайдер её не объявлял — компонент
   может «создать» её с нуля (в выходном CSS появится её блок токенов).

### Цепочка приоритетов (от низшего к высшему)

```
provider.theme.tokenDefinitions        ← базовый слой от донор‑пакета
  → component.tokenDefinitions         ← в порядке resolveSelection (post‑order)
    → themes.tokenOverrides (app)      ← ВЫСШИЙ приоритет, задаётся приложением
```

- Каждый следующий слой может **переопределять** значения предыдущего под
  одним и тем же `(тема, селектор, токен)`.
- Если два компонента публикуют один токен, выигрывает тот, который стоит
  позже в post‑order (обычно — «родитель» зависимости).
- `tokenOverrides` в `presetGranularNode({...})` приложения имеют **абсолютный
  приоритет** над любыми провайдер/компонент значениями и могут добавлять
  новые токены, которых нет ни у кого ниже.

### Use‑cases

1. **Single‑theme фильтрация.** Приложение задаёт `themes: { names: ['light'] }` —
   компонент отгружает только светлые значения; блок `dark` не попадает в CSS.
2. **Multi‑theme.** `themes: { names: ['light', 'dark'] }` — компонент
   выгружает оба блока под соответствующими селекторами.
3. **Override провайдерского токена.** Провайдер объявляет `--brand: red`,
   конкретный компонент уточняет `--brand: crimson` для своего слоя —
   компонент перебивает провайдера.
4. **Final override в приложении.** Приложение поверх компонента фиксирует
   бренд: `tokenOverrides: { light: { ':root': { '--brand': '#0070f3' } } }` —
   победа за приложением.
5. **`strictTokens`.** Токены, объявленные компонентом, считаются «известными»:
   `tokenOverrides` из приложения на такой токен проходит без warning’а.
6. **Компонент «создаёт» тему.** Приложение включает `themes: { names: ['sepia'] }`,
   её не объявлял ни один провайдер — если компонент публикует блок `sepia`,
   эта тема появится в итоговом CSS.

### Разграничение: когда что использовать

| Что                                  | Где объявлять                                     |
|---------------------------------------|---------------------------------------------------|
| Package‑wide токены (бренд, радиусы)  | `provider.theme.tokenDefinitions` / `tokens.css`  |
| Токены одного компонента              | `component.tokenDefinitions` в его `config.ts`    |
| Финальная подстройка под приложение   | `themes.tokenOverrides` в `presetGranularNode`    |

## 8. Зависимости между компонентами

- Внутри своего пакета — **короткая** форма: `'MyIcon'`.
- Компонент из другого пакета — **qualified**: `'@feugene/simple-package:XTest1'`.
- Несколько компонентов из одного донора — **объектная** форма:
  `{ provider: '@feugene/simple-package', components: ['XTest1', 'XTestStyled'] }`.
- Если ваш компонент тянет компонент из другого пакета → пакет‑донор
  обязан быть в `peerDependencies` (см.
  [installation.md](./installation.md)).

## 9. Чек‑лист перед PR / релизом

- [ ] Создана папка `src/components/<Name>/` с файлами
      `<Name>.vue`, `config.ts`, `index.ts`.
- [ ] `config.ts` использует `defineGranularComponent(import.meta.url, ...)`,
      `name` === имя директории.
- [ ] `safelist` содержит **только** динамические классы; статика
      живёт в шаблоне.
- [ ] `cssFiles` (если есть) — пути относительно `config.ts`,
      файлы существуют.
- [ ] `tokenDefinitions` (если есть) — ключи совпадают с именами тем
      провайдера/приложения; значения — валидные CSS custom properties.
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
