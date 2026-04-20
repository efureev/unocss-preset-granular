# Быстрый старт

> Индекс документации: [`./README.md`](./README.md).

## Требования

- **Node ≥ 22**
- **ESM only** (`"type": "module"` в `package.json` приложения)
- **UnoCSS ≥ 66** (пресет протестирован с `@unocss/core` / `@unocss/vite` /
  `@unocss/preset-wind4`)
- TypeScript strict (не обязателен, но желателен)

## Установка

В приложении:

```bash
yarn add -D @feugene/unocss-preset-granular unocss @unocss/preset-wind4
# + любые granular‑провайдеры, которые вы хотите использовать, например:
yarn add -D @feugene/simple-package
```

Провайдеры устанавливает **приложение**, а не пресет. Провайдер‑композит
должен объявлять доноров в `peerDependencies`.

## Минимальный `uno.config.ts`

```ts
import { defineConfig } from 'unocss'
import presetWind4 from '@unocss/preset-wind4'
import { presetGranularNode, granularContent } from '@feugene/unocss-preset-granular/node'
import simpleProvider from '@feugene/simple-package/granular-provider/node'

const granularOptions = {
  providers: [simpleProvider],
  components: [
    { provider: '@feugene/simple-package', names: ['XTest1', 'XTestStyled'] },
  ],
  themes: { names: ['light', 'dark'] },
  layer: 'granular' as const,
}

export default defineConfig({
  presets: [
    presetWind4(),
    presetGranularNode(granularOptions),
  ],
  // ОБЯЗАТЕЛЬНО для авто‑сканирования — см. ./component-scanning.md
  content: granularContent(granularOptions),
})
```

## Подключение к Vite

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import Vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'

export default defineConfig({
  plugins: [Vue(), UnoCSS()],
})
```

В entry:

```ts
// src/main.ts
import 'virtual:uno.css'
import { createApp } from 'vue'
import App from './App.vue'

createApp(App).mount('#app')
```

Готово. Классы, записанные в шаблонах компонентов провайдера (например,
`class="p-5"` внутри `XTest1.vue`), попадут в итоговый CSS **без**
добавления в `safelist`.

## Дальше

- [Использование в приложениях](./usage-in-apps.md) — полный справочник опций.
- [Сканирование компонентов](./component-scanning.md) — **почему
  `granularContent(...)` обязателен** и как это устроено.
- [Написание провайдеров](./authoring-providers.md) — если вы сами делаете
  пакет‑провайдер.
