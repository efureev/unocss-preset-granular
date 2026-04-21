# Installing and wiring `@feugene/unocss-preset-granular`

> Docs index: [`./README.md`](./README.md). See also
> [Getting started](./getting-started.md),
> [Usage in apps](./usage-in-apps.md),
> [Authoring providers](./authoring-providers.md).

This page explains **how to declare the dependency** on
`@feugene/unocss-preset-granular` for different kinds of consumers and,
most importantly, **in which `package.json` section**
(`dependencies`, `devDependencies`, `peerDependencies`) it belongs.

Short rule of thumb:

- **Applications** — put the preset into `devDependencies` (it is used
  only at build time from `uno.config.ts`).
- **Provider packages** (UI‑component packages that export a
  `GranularProvider`) — declare the preset in `peerDependencies`
  **and** mirror it in `devDependencies` (for local build/types).
  Do **not** put it into `dependencies`, otherwise the final
  application tree ends up with several physical copies of the preset.

Details and ready‑to‑copy snippets below.

---

## 1. Wiring into an end application

An application is the thing that is bundled by Vite (or another
bundler) and eventually produces `virtual:uno.css`. The preset is used
only at build time inside `uno.config.ts`; it never reaches the
browser runtime.

### 1.1. Application `package.json`

```jsonc
{
  "name": "my-app",
  "type": "module",
  "devDependencies": {
    "@feugene/unocss-preset-granular": "^0.1.0",
    "unocss": "^66.0.0",
    "@unocss/preset-wind4": "^66.0.0",

    // Providers actually used by the app:
    "@feugene/simple-package": "^0.1.0"
    // "@feugene/extra-simple-package": "^0.1.0",
  }
}
```

Why `devDependencies`, not `dependencies`:

- The preset runs **at build time** (in `uno.config.ts` /
  `vite.config.ts`) and does not ship a single line of code into the
  application bundle.
- Providers are also consumed by the preset at build time (through
  their `granular-provider/node` entry). If the application also
  imports provider components at runtime
  (`import { XTest1 } from '@feugene/simple-package/components/XTest1'`),
  the provider moves into `dependencies`.

### 1.2. Environment requirements

- Node ≥ 22
- `"type": "module"` in the application `package.json` (ESM only)
- `unocss` ≥ 66 (peer of the preset, installed by the application)

For full `uno.config.ts` / `vite.config.ts` wiring see
[Getting started](./getting-started.md).

---

## 2. Wiring into a provider package

A **granular provider** is a published npm package that exports a
`GranularProvider` via
`@feugene/unocss-preset-granular/contract` (and optionally
`@feugene/unocss-preset-granular/node` for build‑time helpers such as
`tokenDefinitionsFromCssFile`).

Inside a provider package the preset is used:

- as **type imports** and factories (`defineGranularComponent`,
  `defineGranularProvider`) at build time and during development;
- **nothing** from the preset ends up in the published provider
  bundle (the factories are identity functions / pure types).

### 2.1. Provider package `package.json`

```jsonc
{
  "name": "@your-scope/your-provider",
  "type": "module",
  "peerDependencies": {
    "@feugene/unocss-preset-granular": "^0.1.0",
    "vue": "^3"
  },
  "devDependencies": {
    "@feugene/unocss-preset-granular": "^0.1.0",
    "vue": "^3"
  }
}
```

Key points:

- `peerDependencies` — **mandatory**. Declares that the preset version
  is controlled by the application; prevents duplicate preset copies
  in the dependency tree (otherwise the `GranularProvider` contract
  would diverge across copies and resolution would break).
- `devDependencies` — mirror the preset here so that the package can
  be built and type‑checked locally (via a workspace link in a
  monorepo, or from the registry in a standalone package).
- `dependencies` — **do not** use it for the preset. Package managers
  would install the preset physically inside the provider's own
  `node_modules`, and the application would get a second copy that
  differs from its own.

### 2.2. Composite provider (depends on another provider)

If your provider declares `dependencies` on components of **another**
provider (e.g. `@feugene/simple-package` as a donor), the donor must
also be a `peerDependency`:

```jsonc
{
  "name": "@feugene/extra-simple-package",
  "peerDependencies": {
    "@feugene/unocss-preset-granular": "^0.1.0",
    "@feugene/simple-package": "^0.1.0",
    "vue": "^3"
  },
  "devDependencies": {
    "@feugene/unocss-preset-granular": "^0.1.0",
    "@feugene/simple-package": "^0.1.0",
    "vue": "^3"
  }
}
```

Rule: **anyone who ships real component code is declared as a
`peerDependency` of the composite provider**. The application is the
one that actually installs it.

### 2.3. What a provider package must export

See [Authoring providers](./authoring-providers.md), section
`package.json exports`. For installation purposes it is enough to
remember: a provider must publish a `./granular-provider` entry
(browser) and preferably `./granular-provider/node` (build time).
Applications import the latter from `uno.config.ts`.

---

## 3. Matrix: which section to use

| Consumer                          | `@feugene/unocss-preset-granular`      | `unocss`            | Provider packages                                                          | `vue`                                  |
| --------------------------------- | -------------------------------------- | ------------------- | -------------------------------------------------------------------------- | -------------------------------------- |
| Application                       | `devDependencies`                      | `devDependencies`   | `devDependencies` (or `dependencies` if components are imported at runtime) | `dependencies`                         |
| Provider package (terminal)       | `peerDependencies` + `devDependencies` | not needed directly¹ | —                                                                          | `peerDependencies` + `devDependencies` |
| Provider package (composite)      | `peerDependencies` + `devDependencies` | not needed directly¹ | `peerDependencies` + `devDependencies` (on the donor)                      | `peerDependencies` + `devDependencies` |

¹ `unocss` is a peer of the preset itself. If your provider does not
import `unocss` directly (the usual case), there is no need to list
it in its `package.json` — the transitive peer is satisfied by the
application.

---

## 4. Common mistakes

- **Preset in provider's `dependencies`.** It may "work" in a monorepo
  thanks to hoisting, but in a third‑party application it results in
  two copies of the preset and unpredictable `GranularProvider`
  resolution. Fix: move to `peerDependencies` (+ mirror in
  `devDependencies`).
- **Providers in preset's `dependencies`.** The preset is intentionally
  unaware of any concrete UI package. Providers are installed by the
  application only. The preset itself depends solely on `unocss`
  (peer).
- **Missing `devDependency` on the preset inside a provider.** Then
  `peerDependencies` alone is not enough to build the package locally
  (no types, no factories). Fix: duplicate the preset in
  `devDependencies` explicitly.
- **Major version drift between app and provider.** Declare the
  `peerDependencies` range conservatively (`^X.Y.Z` matching the
  current major) and bump it in lock‑step with contract refactorings.

---

## 5. Verifying the wiring

In the application after install:

```bash
# There must be exactly one resolved version of the preset:
yarn why @feugene/unocss-preset-granular

# The provider must be reachable through its build‑time entry:
node -e "import('@feugene/simple-package/granular-provider/node').then(m => console.log(Object.keys(m)))"
```

If `yarn why` shows several physically distinct paths to
`@feugene/unocss-preset-granular`, some provider has declared the
preset in `dependencies` instead of `peerDependencies`; this must be
fixed in the provider's `package.json`.
