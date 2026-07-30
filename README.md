# `@feugene/unocss-preset-granular`

A universal UnoCSS preset that aggregates styles, themes and `safelist` from
any number of **granular providers** (component packages). The preset itself
is UI‑agnostic — it works on top of the public `GranularProvider` contract.

- **ESM only**, Node ≥ 22, TypeScript strict.
- Five entries: `.` (browser), `./node` (build‑time FS),
  `./contract` (types + helpers for provider authors),
  `./vite` (build helpers for a provider's own bundle),
  `./runtime` (runtime theme switching, zero deps).
- Transitive `dependencies` (including cross‑provider) are resolved from a
  single component registry.
- Static classes from provider components are picked up by UnoCSS via
  `content.filesystem` — no duplication in `safelist`.

## Why this preset

- **Ship only the CSS you actually use.** Only styles of explicitly selected
  components (+ their transitive `dependencies`) get into the final bundle.
- **Single source of truth.** Static classes live in component templates;
  no parallel list in app‑level `safelist`.
- **UI‑agnostic.** Works with any component library that implements the
  `GranularProvider` contract (Vue, React, Svelte, web components, raw CSS).
- **Cross‑package dependencies.** One component can depend on another from
  a different provider — the preset resolves the graph.
- **Built‑in themes & tokens.** Aggregates CSS variables / theme files from
  providers with a single `themes.names` switch.
- **App‑owned themes.** The app declares its own themes with `themes.define` —
  inheriting a provider theme via `extends`, or dropping `light`/`dark`
  entirely in favour of its own palette.

## Results

- Zero manual `safelist` for static component classes.
- Smaller CSS: no styles of unused components reach the user.
- Provider upgrades don't require app‑side changes — new component styles
  are picked up automatically when the component is selected.
- Consistent theming: same `light`/`dark`/custom themes across providers.

## Use cases

- **Design system as an npm package** — publish components with their own
  CSS/tokens; apps pull in only what they render.
- **Monorepo with multiple UI packages** — one app consumes several
  component libraries, dependencies across them resolved automatically.
- **White‑label / multi‑tenant apps** — swap themes per tenant without
  re‑authoring components, including
  [at runtime](./docs/en/themes-and-tokens.md#switching-themes-at-runtime).
- **Micro‑frontends** — each MFE picks its own component subset from
  shared providers; no cross‑team `safelist` coordination.
- **Incremental migration to UnoCSS** — adopt granular packages one at a
  time while keeping existing styles intact.

## Quick start

```bash
yarn add -D @feugene/unocss-preset-granular unocss @unocss/preset-wind4
```

```ts
// uno.config.ts
import { defineConfig } from 'unocss'
import presetWind4 from '@unocss/preset-wind4'
import { presetGranularNode, granularContent } from '@feugene/unocss-preset-granular/node'
import simpleProvider from '@feugene/simple-package/granular-provider/node'

const granularOptions = {
  providers: [simpleProvider],
  components: [{ provider: '@feugene/simple-package', names: ['XTest1', 'XTestStyled'] }],
  themes: { names: ['light', 'dark'] },
  layer: 'granular' as const,
}

export default defineConfig({
  presets: [presetWind4(), presetGranularNode(granularOptions)],
  content: granularContent(granularOptions), // required — see docs
})
```

## Documentation

Full documentation lives in [`./docs`](./docs) — in **English** and **Russian**.

🇬🇧 **English** — [`./docs/en/README.md`](./docs/en/README.md)

- [Getting started](./docs/en/getting-started.md)
- [Usage in applications](./docs/en/usage-in-apps.md)
- [Authoring provider packages](./docs/en/authoring-providers.md)
- [Component scanning (`content.filesystem`)](./docs/en/component-scanning.md)
- [Themes and tokens](./docs/en/themes-and-tokens.md)
- [Architecture](./docs/en/architecture.md)
- [Troubleshooting & recipes](./docs/en/troubleshooting.md)
- [The `granular` CLI](./docs/en/cli.md)

🇷🇺 **Русский** — [`./docs/ru/README.md`](./docs/ru/README.md)

- [Быстрый старт](./docs/ru/getting-started.md)
- [Использование в приложениях](./docs/ru/usage-in-apps.md)
- [Написание пакетов‑провайдеров](./docs/ru/authoring-providers.md)
- [Сканирование компонентов (`content.filesystem`)](./docs/ru/component-scanning.md)
- [Темы и токены](./docs/ru/themes-and-tokens.md)
- [Архитектура](./docs/ru/architecture.md)
- [Рецепты и отладка](./docs/ru/troubleshooting.md)
- [CLI `granular`](./docs/ru/cli.md)

## CLI — `granular`

The package ships a `granular` binary with three diagnostic commands. `doctor`
prints the resolved configuration — providers, the transitive component graph,
theme names (and where they came from), token conflicts between layers, the
scan globs, and any component directory that violates the layout contract;
`explain` says why a component is in the build; `why-css` says which component
pulled a class into the CSS:

```bash
# granular.options.mjs — the same options object you pass to the preset
npx granular doctor  ./granular.options.mjs --strict
npx granular explain ./granular.options.mjs XButton
npx granular why-css ./granular.options.mjs text-red-500
```

Exit code `1` means layout‑contract violations were found (with `--strict`,
warnings too), so it can be used as a CI check; `--json` gives every command a
structured report. Full reference: [The `granular` CLI](./docs/en/cli.md).

## Reference packages in this monorepo

- [`packages/unocss-preset-granular`](./packages/unocss-preset-granular) — the preset itself.
- [`packages/simple-package`](./packages/simple-package) and
  [`packages/extra-simple-package`](./packages/extra-simple-package) — two
  reference granular providers (the extra one declares cross‑provider
  `dependencies` on the simple one).
- [`apps/app-1..6`](./apps) — six demo apps, each covering one scenario:
  minimal auto‑scan (`app-1`), `safelist` + theme token overrides without the
  file scan (`app-2`), a transitive donor provider and cross‑package component
  dependencies (`app-3`), nested SFCs plus a third‑party rule set (`app-4`),
  runtime theme switching (`app-5`), app‑owned themes replacing the provider's
  `light`/`dark` (`app-6`).

They are the only place where the whole chain — provider build → preset →
UnoCSS → CSS — runs end to end, so they double as the contract's integration
test:

```bash
yarn build:all && yarn verify:apps
```

`verify:apps` compares each app's built CSS against `apps/<app>/expected-css.mjs`
— the list of things that must (and must not) be in the output. A green build
alone proves nothing: it stays green when component classes silently vanish
from the CSS.

## License

See [LICENSE](./LICENSE).
