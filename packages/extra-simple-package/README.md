# `@feugene/extra-simple-package`

The **composite reference provider** for
[`@feugene/unocss-preset-granular`](../unocss-preset-granular/README.md): a
provider package whose components are built on top of another provider's
components, and which pulls that donor in transitively.

- ESM only, Node ≥ 22, TypeScript strict.
- `@feugene/unocss-preset-granular`, `@feugene/simple-package` and `vue` are
  `peerDependencies`.
- Unlike `@feugene/simple-package`, this package does **not** use
  `libInjectCss` — a deliberate difference, so that the `cssFiles` path of the
  contract is exercised too.

## What it is for

Where [`@feugene/simple-package`](../simple-package/README.md) proves that a
*base* provider is implementable, this package proves that providers
**compose**. It answers two questions the contract has to get right:

1. **Package-level composition** — `GranularProvider.dependencies` lets a
   provider declare its donor, so the application registers only this provider
   and the preset expands `@feugene/simple-package` transitively.
2. **Component-level composition** — `component.dependencies` lets a component
   declare that it renders a donor's component, so selecting `XgQuick` also
   pulls the CSS, safelist and tokens of `@feugene/simple-package:XTest1`.

Its role in the workspace:

| Package | Role |
|---|---|
| `@feugene/unocss-preset-granular` | the preset — defines the contract |
| `@feugene/simple-package` | base provider — the donor |
| **`@feugene/extra-simple-package`** | **composite provider — depends on the donor** |
| `apps/app-3`, `apps/app-4` | applications that consume it |

## Components

| Component | Depends on | Covers |
|---|---|---|
| `XgQuick` | `@feugene/simple-package:XTest1` | transitive scan across two packages, plus `cssFiles: ['./styles.css']` — the package has no `libInjectCss`, so without that declaration `.xg-quick` would never reach the application |
| `XTokenizedLevel2` | `@feugene/simple-package:XTokenized` | transitive **theme tokens**: selecting this component activates the donor's `tokenDefinitionsRef`, two levels deep |

## Install

```bash
yarn add @feugene/extra-simple-package @feugene/simple-package
```

A composite provider lists its donor in `peerDependencies` — installing both is
the application's responsibility.

## Usage

The application registers **only this provider**; the donor arrives through
`dependencies`:

```ts
import { defineConfig, presetMini } from 'unocss'
import { granularContent, presetGranularNode } from '@feugene/unocss-preset-granular/node'
import extraProvider from '@feugene/extra-simple-package/granular-provider/node'

const granularOptions = {
  // @feugene/simple-package is expanded transitively
  providers: [extraProvider],
  components: ['@feugene/extra-simple-package:XgQuick'],
}

export default defineConfig({
  presets: [presetMini(), presetGranularNode(granularOptions)],
  content: granularContent(granularOptions),
})
```

Registering a donor provider does **not** select its components: selection stays
with the application (`options.components`) or with the dependency graph of the
components it did select.

## Entry points

| Subpath | Contents |
|---|---|
| `.` | barrel with all components |
| `./components/XgQuick`, `./components/XTokenizedLevel2` | one component each |
| `./granular-provider` | browser entry — imports the donor's **browser** entry |
| `./granular-provider/node` | node entry — imports the donor's **node** entry |

The two entries share one factory, `createExtraProvider(donor)`, and differ only
in which variant of the donor they pass in. That is not a formality: importing
the donor's node entry from the browser module would drag `node:fs` into the
client bundle transitively — and the build would still succeed. Verify against
the built bundle, not the sources:

```bash
grep -rn "unocss-preset-granular/node" \
  packages/extra-simple-package/dist/granular-provider.js \
  packages/extra-simple-package/dist/chunks/*.js   # must be empty
```

## Building

Build order is part of the contract — this package compiles against the `dist`
of both the preset and the donor:

```bash
yarn build:all      # preset → extra rules → providers → apps
```

```bash
ls packages/extra-simple-package/dist/components/XgQuick/index.js
ls packages/extra-simple-package/dist/components/XgQuick/styles.css
yarn verify:apps
```

## Documentation

- [Authoring provider packages](../../docs/en/authoring-providers.md)
- [Component authoring rules](../../docs/en/component-authoring.md)
- [Architecture](../../docs/en/architecture.md)

## License

[MIT](./LICENSE) © Evgeniy Fureev
