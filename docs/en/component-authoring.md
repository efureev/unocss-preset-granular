# Component authoring rules for a provider package

This document is the **single consolidated guide** on how to add a new
component to a granular package (e.g. `@feugene/simple-package`) so that
it's correctly picked up by the `@feugene/unocss-preset-granular` preset:
scanned by UnoCSS, shipped with its styles, added to `safelist` only when
necessary, and exposed as a dedicated `exports` subpath.

> Related documents:
> - [Authoring provider packages](./authoring-providers.md) — overall
>   `GranularProvider` contract, `granular-provider/index.ts`,
>   `packageBaseUrl`, `chunkFileNames` recipe.
> - [Component scanning](./component-scanning.md) — why
>   `granularContent(...)` is mandatory and how classes are discovered.
> - [Themes and tokens](./themes-and-tokens.md) — `base.css`,
>   `tokens.css`, per‑theme CSS.
> - [Installation & wiring](./installation.md) — which `package.json`
>   section should host the preset / donor packages.

## 1. Component directory layout

**Required** structure for every component:

```
packages/<your-package>/src/components/<ComponentName>/
├─ <ComponentName>.vue      ← SFC (template + <script setup lang="ts">)
├─ config.ts                ← defineGranularComponent(...)
├─ index.ts                 ← public re‑export
├─ styles.css               ← component‑local CSS (optional)
└─ <internal>.ts            ← private helpers (optional)
```

Rules:

- **Directory name === component name** (PascalCase). The preset builds
  scan globs and dist paths off the directory name.
- **`.vue` file name === directory name**. Required both for DX and for
  the `chunkFileNames` recipe (see
  [authoring-providers.md](./authoring-providers.md#vite-build-recipe--chunkfilenames)).
- All internal modules of the component (`dsStyles.ts`, helpers,
  partial SFCs) **must live inside** its folder — only then they are
  part of the UnoCSS scan directory.
- Cross‑component utilities (`src/utils/classTokens.ts`, etc.) are
  fine, but they are **not scanned** as part of a component — static
  classes coming from them won't land in the final CSS unless listed in
  a `safelist` explicitly. Keep such helpers under `src/utils/`, not
  under `src/components/`, so the component scan directory stays clean.

## 2. `config.ts` — `defineGranularComponent`

Every component must export its config through
`defineGranularComponent(import.meta.url, {...})` from
`@feugene/unocss-preset-granular/contract`.

```ts
// src/components/MyButton/config.ts
import { defineGranularComponent } from '@feugene/unocss-preset-granular/contract'

export const myButtonConfig = defineGranularComponent(import.meta.url, {
  // 1. Component name (PascalCase, === directory name)
  name: 'MyButton',

  // 2. Transitive dependencies (short / qualified / object form)
  dependencies: [
    'MyIcon',                                   // same provider
    '@feugene/simple-package:XTestStyled',      // another provider
    { provider: '@feugene/simple-package', components: ['XTest1'] },
  ],

  // 3. ONLY dynamic classes that can't be extracted statically from
  //    the template (computed, template literals, attr, runtime
  //    bindings). Static classes will be picked up via
  //    content.filesystem.
  safelist: [
    /^my-button--/,
    'my-button--disabled',
  ],

  // 4. Component CSS — always shipped into the final CSS as a preflight
  cssFiles: ['./styles.css'],

  // 5. Override scan directory (rarely needed)
  sourceDir: './',
})
```

### Field rules

| Field          | TL;DR                                                                     |
|----------------|---------------------------------------------------------------------------|
| `name`         | PascalCase, strictly === directory name.                                  |
| `dependencies` | Only components your **template** truly depends on.                       |
| `safelist`     | `string \| RegExp`. Only what **can't** be extracted statically.          |
| `cssFiles`     | Paths relative to `config.ts`. Shipped as UnoCSS `preflights`.            |
| `sourceDir`    | Defaults to `'./'` — directory of `config.ts`. Don't touch without reason.|

### `safelist` — critical

- ❌ Don't list `p-5`, `text-lg`, `flex` here — that's **static**, UnoCSS
  extracts it on its own via `content.filesystem`.
- ✅ Do list: classes built from `computed`, `` `foo-${props.size}` ``,
  conditional `:class` bindings, classes assembled in JS modules living
  outside the component's folder.
- If your `safelist` grows large, most likely the layout is broken or
  the scan directory is wrong (→
  [component-scanning.md](./component-scanning.md)).

### `import.meta.url` is mandatory

The first argument to `defineGranularComponent` is `import.meta.url` of
the `config.ts` itself. The preset uses it to resolve `cssFiles[i]` and
`sourceDir` as `new URL(path, import.meta.url)`. Don't replace it, don't
move `config.ts` out of the component folder.

## 3. SFC: `<ComponentName>.vue`

```vue
<script setup lang="ts">
// Typed props/emits, composables. Nothing related to runtime
// preset registration is required here.
defineProps<{ disabled?: boolean }>()
</script>

<template>
  <!-- Static class literals are the best case — UnoCSS finds them via scan -->
  <button class="px-4 py-2 rounded bg-primary text-white">
    <slot />
  </button>
</template>

<style scoped>
/* scoped CSS that doesn't depend on safelist */
</style>
```

Guidelines:

- Prefer **static** `class="..."` — it's free (UnoCSS scanner +
  `content.filesystem`).
- Keep dynamic `:class` flat; anything not present as a static literal
  must be covered by `safelist` in `config.ts`.
- CSS that must **always** ship (component reset/layout) belongs in
  `styles.css` referenced via `cssFiles`. It becomes a UnoCSS
  `preflight` and does **not** depend on the scan result.

## 4. `index.ts` — public re‑export

Exactly two exports — default and named:

```ts
// src/components/MyButton/index.ts
export { default } from './MyButton.vue'
export { default as MyButton } from './MyButton.vue'
```

This lets the app use either form:

```ts
import MyButton from '@your-scope/your-package/components/MyButton'
// or
import { MyButton } from '@your-scope/your-package'
```

## 5. Wiring the component into the package and the provider

After the component folder is created, wire it in **three** places:

### 5.1. Root `src/index.ts` of the package

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
  packageBaseUrl: /* runtime concat, see authoring-providers.md */,
  components: [myButtonConfig, myIconConfig],
  // theme: { ... }, unocss: { ... }
})
```

Every new component must appear in `components: [...]`, otherwise the
preset doesn't "see" it even if the app lists it in
`components: [...]` of `uno.config.ts`.

### 5.3. `package.json → exports` and Vite `build.lib.entry`

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
      // see authoring-providers.md → chunkFileNames
    },
  },
}
```

Without this the dist will not contain
`dist/components/MyButton/index.js`, and the preset's scan directory
will be empty.

## 6. Component CSS (`styles.css`)

- Paths in `cssFiles` are **relative to `config.ts`**.
- Avoid `@apply` with classes that might be missing from the final
  bundle (they resolve through the same UnoCSS, but with a broken scan
  they may be absent) — see [troubleshooting.md](./troubleshooting.md).
- Use variables from the provider's `base.css` / `tokens.css` instead
  of hard‑coding values — see
  [themes-and-tokens.md](./themes-and-tokens.md).
- The package's `package.json` must keep
  `"sideEffects": ["**/*.css"]` — otherwise the app bundler will tree
  shake the component CSS away.

## 7. Dependencies between components

- Same package — **short** form: `'MyIcon'`.
- Cross‑package — **qualified**: `'@feugene/simple-package:XTest1'`.
- Multiple components from one donor — **object** form:
  `{ provider: '@feugene/simple-package', components: ['XTest1', 'XTestStyled'] }`.
- Any cross‑provider dep means the donor package must be in
  `peerDependencies` (see [installation.md](./installation.md)).

## 8. Pre‑PR / pre‑release checklist

- [ ] Folder `src/components/<Name>/` with `<Name>.vue`, `config.ts`,
      `index.ts` created.
- [ ] `config.ts` uses `defineGranularComponent(import.meta.url, ...)`,
      `name` === directory name.
- [ ] `safelist` contains **only** dynamic classes; statics live in
      the template.
- [ ] `cssFiles` (if any) — paths relative to `config.ts`, files exist.
- [ ] `dependencies` are correct (short / qualified / object form).
- [ ] Component re‑exported from `src/index.ts`.
- [ ] Component config added to `components: [...]` in the provider
      (`src/granular-provider/index.ts`).
- [ ] `package.json.exports` publishes `./components/<Name>`.
- [ ] `vite.config.ts → build.lib.entry` has an entry for the component.
- [ ] `sideEffects` in `package.json` preserves CSS.
- [ ] `vite build` → `dist/components/<Name>/index.js` exists, SFC
      chunks land in `dist/components/<Name>/chunks/*.js` (not a flat
      `dist/chunks/*`).
- [ ] Smoke test in a playground app: pick **only** this component in
      the preset's `components`, run `vite build`, verify that classes
      from its template land in the CSS **without** any `safelist`
      additions.
