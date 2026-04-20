# Authoring provider packages

A **granular provider** is a regular npm package that exposes a
`GranularProvider` object via the
`@feugene/unocss-preset-granular/contract` helpers. The end application picks
it up through its `uno.config.ts` and pulls in only the components / themes it
actually uses.

> See also: [Architecture](./architecture.md),
> [Component scanning](./component-scanning.md).

## Package layout

Recommended layout (this is what the reference packages
`@feugene/simple-package` / `@feugene/extra-simple-package`
use):

```
packages/<your-package>/
├─ src/
│  ├─ components/
│  │  ├─ MyButton/
│  │  │  ├─ MyButton.vue
│  │  │  ├─ config.ts        ← defineGranularComponent(...)
│  │  │  ├─ styles.css       ← component‑local CSS (optional)
│  │  │  └─ index.ts         ← re‑export of the component
│  │  └─ MyIcon/
│  │     └─ ...
│  ├─ styles/
│  │  ├─ base.css
│  │  ├─ tokens.css
│  │  └─ themes/{light,dark}.css
│  └─ granular-provider/
│     ├─ index.ts            ← browser entry (default export = provider)
│     └─ node.ts             ← optional node entry (tokenDefinitions, FS‑only helpers)
├─ package.json              ← must expose the granular-provider subpaths
└─ vite.config.ts            ← library build; see "Vite build recipe" below
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

A **composite** provider (one that declares `dependencies` on components from
another provider) must add that donor to its own `peerDependencies` — the
application is responsible for installing both.

## Define a component: `config.ts`

```ts
// packages/<your-package>/src/components/MyButton/config.ts
import { defineGranularComponent } from '@feugene/unocss-preset-granular/contract'

export const buttonConfig = defineGranularComponent(import.meta.url, {
  name: 'MyButton',

  // ONLY classes that can't be statically extracted from the template
  // (dynamic, computed, template‑literal, attr(...)). Static classes are
  // picked up by UnoCSS via content.filesystem — don't duplicate them.
  safelist: [
    /^my-button--/,           // regex is fine
    'my-button--disabled',
  ],

  // CSS that ships with the component and should always be present as a
  // preflight in the final CSS (independent of template usage).
  cssFiles: ['./styles.css'],

  dependencies: [
    // same provider, short form:
    'MyIcon',

    // another provider, qualified form:
    '@feugene/simple-package:XTestStyled',

    // object form — multiple names from one provider:
    { provider: '@feugene/simple-package', components: ['XTest1', 'XTestStyled'] },
  ],

  // Optional: extra source dir for UnoCSS scan, relative to config.ts.
  // Default: './' — i.e. the directory of config.ts itself.
  // Use this if your component's source lives in a non‑standard layout.
  sourceDir: './',
})
```

Notes:

- The **first argument** is `import.meta.url` of the component's `config.ts`.
  The preset uses it to resolve `cssFiles[i]` and `sourceDir` via `new URL(...,
  import.meta.url)`.
- `safelist` entries may be `string` or `RegExp`.
- Keep `safelist` minimal. If you find yourself listing `p-5`, `text-lg` etc.,
  you probably just need the component to be scannable (→
  [Component scanning](./component-scanning.md)).

## Define the provider: `granular-provider/index.ts`

```ts
import { defineGranularProvider } from '@feugene/unocss-preset-granular/contract'
import { buttonConfig } from '../components/MyButton/config'
import { iconConfig } from '../components/MyIcon/config'

export default defineGranularProvider({
  id: '@your-scope/your-package',
  contractVersion: 1,

  // URL of the package assets root. Used by the /node layer for
  // src/ ↔ dist/ fallback and for component scan globs.
  //
  // Caveat: the literal `new URL('..', import.meta.url)` is replaced with
  // a data: URL by rolldown at build time — we build the URL at runtime:
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
    // optional: rules / variants / preflights needed by the package's components
    // rules: [[/^my-grad$/, () => ({ 'background-image': '...' })]],
  },
})
```

For the optional node entry (`granular-provider/node.ts`) see
[Themes and tokens → `tokenDefinitionsFromCss*`](./themes-and-tokens.md).

## Vite build recipe — `chunkFileNames`

This is **critical** for libraries that ship components as Vue SFCs and want
them to be scannable by the preset. By default Vite's `rollup-plugin-vue`
emits SFC chunks into a flat `dist/chunks/` folder, far from the component's
declared dir. The preset's scan globs point at the component dir, so those
chunks don't get scanned — and classes like `p-5` never reach the final CSS.

The fix is to route **SFC chunks into the component's own sub‑folder**:

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
        // Route SFC chunks into the component's folder:
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

Why it matters: without this, `dist/components/MyButton/index.js` is only a
re‑export; the real template markup (with `class="p-5"` literals) lives in
`dist/chunks/*.js`. Moving SFC chunks into `components/<Name>/chunks/` keeps
them inside the scan directory of the selected component.

## Rules recap

- `safelist` → **only** component's own dynamic classes.
- `dependencies` → declare transitive components (same‑provider short name,
  `providerId:Name`, or object form).
- `cssFiles` → component‑local CSS that must always ship as preflight.
- `sourceDir` → override source scan dir (rarely needed).
- `packageBaseUrl` → must point to the **package directory**, not a module.
- Always use runtime‑built `packageBaseUrl` if you bundle with
  Vite/rolldown — `new URL('..', import.meta.url)` is transformed into a
  `data:` URL at build time.
- The donor provider of any cross‑provider `dependencies` must be in
  `peerDependencies`.

## Publishing checklist

- [ ] `dist/` contains `granular-provider/index.js` (+ `node.js` if used).
- [ ] `dist/components/<Name>/index.js` exists for every component and
      `dist/components/<Name>/chunks/*.js` contain the real SFC code.
- [ ] `package.json.exports` maps all those subpaths.
- [ ] `peerDependencies` lists `@feugene/unocss-preset-granular`, `vue`, and
      every donor provider you declare as `dependencies`.
- [ ] No references to `data:` URLs in runtime code (sanity check of
      `packageBaseUrl`).
- [ ] Smoke test: install the package in a fresh app, add it to `providers`,
      pick one component, run `vite build`, check that its classes land in
      the final CSS without adding `safelist`.
