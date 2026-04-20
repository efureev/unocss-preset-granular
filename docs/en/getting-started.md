# Getting started

> Full docs index: [`./README.md`](./README.md).

## Requirements

- **Node ≥ 22**
- **ESM only** (`"type": "module"` in your app's `package.json`)
- **UnoCSS ≥ 66** (the preset is tested against `@unocss/core` /
  `@unocss/vite` / `@unocss/preset-wind4`)
- TypeScript strict mode (optional but recommended)

## Install

In the app:

```bash
yarn add -D @feugene/unocss-preset-granular unocss @unocss/preset-wind4
# + any granular providers you want to use, for example:
yarn add -D @feugene/simple-package
```

Providers are installed by the **application**, not by the preset. A composite
provider must declare its donor providers in `peerDependencies`.

## Minimal `uno.config.ts`

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
  // MANDATORY for auto component scanning — see ./component-scanning.md
  content: granularContent(granularOptions),
})
```

## Hook it into Vite

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import Vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'

export default defineConfig({
  plugins: [Vue(), UnoCSS()],
})
```

Then in your entry:

```ts
// src/main.ts
import 'virtual:uno.css'
import { createApp } from 'vue'
import App from './App.vue'

createApp(App).mount('#app')
```

That's it. Classes written inside provider components' templates — e.g.
`class="p-5"` inside `XTest1.vue` — will end up in the final CSS without
being duplicated in `safelist`.

## Next steps

- [Usage in applications](./usage-in-apps.md) — full options reference.
- [Component scanning](./component-scanning.md) — **why `granularContent(...)`
  is required** and how it works.
- [Authoring providers](./authoring-providers.md) — if you want to publish a
  provider package yourself.
