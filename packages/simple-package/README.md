# `@feugene/simple-package`

The **base reference provider** for
[`@feugene/unocss-preset-granular`](../unocss-preset-granular/README.md): a
small Vue 3 component package that implements the `GranularProvider` contract
end to end.

- ESM only, Node ≥ 22, TypeScript strict.
- `@feugene/unocss-preset-granular` and `vue` are `peerDependencies` —
  the package ships components and a provider descriptor, nothing else.
- Published as a library build: every granular component is its own entry, so
  the preset can scan `dist/components/<Name>/` per component.

## What it is for

The preset collects CSS, theme tokens and `safelist` from *provider packages*.
This package is the canonical example of such a provider, and at the same time
the repository's proof that the contract is implementable at all: `apps/app-1`,
`app-2`, `app-4`, `app-5` and `app-6` consume it and assert the emitted CSS
against their `expected-css.mjs`. A change that breaks this package breaks the
contract.

Its role in the workspace:

| Package | Role |
|---|---|
| `@feugene/unocss-preset-granular` | the preset — defines the contract |
| **`@feugene/simple-package`** | **base provider — implements the contract** |
| `@feugene/extra-simple-package` | composite provider — depends on this one |
| `apps/app-1..6` | applications — integration tests of the contract |

## What each component demonstrates

Every component here exists to cover one clause of the contract, not to be
useful UI:

| Component | Covers |
|---|---|
| `XTest1` | the minimum: a scannable SFC whose template utilities (`p-4`, `border-[var(--brd)]`) and `<style>` with `@apply` reach the app's CSS |
| `XTestStyled` | `safelist` for classes that cannot be extracted statically — they come from `dsStyles.ts`, not from the template |
| `XTokenized` | theme tokens declared as **`tokenDefinitionsRef`** — references to `themes/{light,dark}.css`, read by the preset's node layer |
| `XNested` | nested subfolders: `parts/*.vue` are compiled into `dist/components/XNested/chunks/` and stay scannable |
| `XNestedReverse` | the same, but with the source living outside `src/components/<Name>/` (`reverses/`) — the layout contract applies to `dist`, not to `src` |
| `XGroupAOne` / `XGroupATwo` | `group: 'groupA'` — two components sharing one SFC; the shared chunk lands in `dist/groups/groupA/shared/` and is scanned because of the group |

## Install

```bash
yarn add @feugene/simple-package
```

Peer dependencies must be present in the application:

```bash
yarn add -D @feugene/unocss-preset-granular unocss
yarn add vue
```

## Usage

Register the provider in `uno.config.ts` and select the components the
application actually uses:

```ts
import { defineConfig, presetMini } from 'unocss'
import { granularContent, presetGranularNode } from '@feugene/unocss-preset-granular/node'
import simpleProvider from '@feugene/simple-package/granular-provider/node'

const granularOptions = {
  providers: [simpleProvider],
  components: ['@feugene/simple-package:XTest1'],
}

export default defineConfig({
  presets: [presetMini(), presetGranularNode(granularOptions)],
  content: granularContent(granularOptions),
})
```

Import the components themselves from their subpaths:

```vue
<script setup lang="ts">
import { XTest1 } from '@feugene/simple-package/components/XTest1'
</script>
```

## Entry points

| Subpath | Contents |
|---|---|
| `.` | barrel — `XTest1`, `XTestStyled`, `XTokenized`, `XNested` |
| `./components/<Name>` | one component (`XTest1`, `XTestStyled`, `XTokenized`, `XNested`, `XNestedReverse`, `XGroupAOne`, `XGroupATwo`) |

Prefer the per-component subpath. The barrel deliberately omits
`XNestedReverse`, `XGroupAOne` and `XGroupATwo`: their sources sit deeper than
`src/components/<Name>/`, which the default `componentModuleRegex` of
`granularChunkFileNames()` does not recognise. With a single consumer their SFC
is inlined into the component entry and everything holds; a second importer
turns it into a shared chunk that lands in flat `dist/chunks/` — outside the
scan. The build stays green while the component's classes vanish from the
application CSS (`yarn verify:apps` catches it on `app-4`).
| `./granular-provider` | browser entry of the provider — free of `node:` imports |
| `./granular-provider/node` | node entry, the one `uno.config.ts` imports |

Since `0.5.0` the node entry is `export * from './index'`: theme tokens are
declared by reference (`tokenDefinitionsRef`) and read by the preset, so the
provider no longer needs a paired `config.node.ts` and no FS import can leak
into the browser bundle. The entry is kept because it is public API and the
place where node-specific logic would go if it ever became necessary.

## Themes

The package deliberately declares **no provider-level `theme`**. Theme tokens
live on the component (`XTokenized/config.ts`), because the *set* of themes
belongs to the application, not to the provider — the package only supplies the
values a theme can be built from. See `apps/app-5` (provider themes) and
`apps/app-6` (application-owned themes via `themes.define`).

## Building

Build order is part of the contract — the provider compiles against the
preset's `dist`:

```bash
yarn build:all      # preset → extra rules → providers → apps
```

Building this package alone on top of a stale preset `dist` succeeds and
produces wrong CSS. After changing a component, verify the layout survived:

```bash
ls packages/simple-package/dist/components/XTest1/index.js
ls packages/simple-package/dist/components/XTest1/styles.css
yarn verify:apps
```

## Documentation

- [Authoring provider packages](../../docs/en/authoring-providers.md)
- [Component authoring rules](../../docs/en/component-authoring.md)
- [Component scanning](../../docs/en/component-scanning.md)
- [Themes and tokens](../../docs/en/themes-and-tokens.md)

## License

[MIT](./LICENSE) © Evgeniy Fureev
