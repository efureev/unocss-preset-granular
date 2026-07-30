# `@feugene/unocss-preset-granular`

Universal UnoCSS preset that aggregates styles, themes and `safelist` from
any number of **granular providers** (component packages).

- ESM only, Node ≥ 22, TypeScript strict.
- Five entries: `.` (browser), `./node` (build‑time FS),
  `./contract` (types + `defineGranular*` helpers),
  `./vite` (build helpers for a provider's own bundle),
  `./runtime` (runtime theme switching, zero deps).
- Transitive `dependencies` (including cross‑provider) are resolved from a
  single component registry.
- Static classes from provider components are picked up by UnoCSS via
  `content.filesystem` — no duplication in `safelist`.

## Why / results

- Ship only the CSS of components the app actually selects (+ their
  transitive `dependencies`); no manual `safelist` for static classes.
- Single source of truth: classes live in component templates, not in app
  config.
- UI‑agnostic contract → works with Vue/React/Svelte/web‑components/CSS.
- Cross‑provider dependencies and aggregated themes/tokens out of the box.

## Use cases

- Design system published as an npm package.
- Monorepo with several UI libraries consumed by one app.
- White‑label / multi‑tenant apps with swappable themes.
- Micro‑frontends sharing component providers.
- Incremental adoption of UnoCSS on top of an existing codebase.

## Install

```bash
yarn add -D @feugene/unocss-preset-granular unocss @unocss/preset-wind4
```

## Quick start

```ts
// uno.config.ts
import { defineConfig } from 'unocss'
import presetWind4 from '@unocss/preset-wind4'
import { presetGranularNode, granularContent } from '@feugene/unocss-preset-granular/node'
import simpleProvider from '@feugene/simple-package/granular-provider/node'

const granularOptions = {
  providers: [simpleProvider],
  components: [{ provider: '@feugene/simple-package', names: ['XTest1'] }],
  themes: { names: ['light', 'dark'] },
  layer: 'granular' as const,
}

export default defineConfig({
  presets: [presetWind4(), presetGranularNode(granularOptions)],
  content: granularContent(granularOptions),   // required
})
```

## Documentation

Full documentation is in the monorepo root, in English and Russian:

🇬🇧 **English** — [`docs/en`](../../docs/en/README.md)
([Getting started](../../docs/en/getting-started.md) ·
[Usage in apps](../../docs/en/usage-in-apps.md) ·
[Authoring providers](../../docs/en/authoring-providers.md) ·
[Component scanning](../../docs/en/component-scanning.md) ·
[Themes and tokens](../../docs/en/themes-and-tokens.md) ·
[Architecture](../../docs/en/architecture.md) ·
[Troubleshooting](../../docs/en/troubleshooting.md) ·
[CLI](../../docs/en/cli.md))

🇷🇺 **Русский** — [`docs/ru`](../../docs/ru/README.md)
([Быстрый старт](../../docs/ru/getting-started.md) ·
[Использование в приложениях](../../docs/ru/usage-in-apps.md) ·
[Написание провайдеров](../../docs/ru/authoring-providers.md) ·
[Сканирование компонентов](../../docs/ru/component-scanning.md) ·
[Темы и токены](../../docs/ru/themes-and-tokens.md) ·
[Архитектура](../../docs/ru/architecture.md) ·
[Рецепты и отладка](../../docs/ru/troubleshooting.md) ·
[CLI](../../docs/ru/cli.md))

## CLI — `granular`

`doctor` prints the resolved configuration: providers, the transitive component
graph, theme names and their origin, token conflicts, scan globs, and
layout‑contract violations (exit code `1` when any are found — usable as a CI
check; `--strict` fails on warnings too). `explain` says why a component is in
the build, `why-css` says which component pulled a class into the CSS. Every
command takes `--json`.

```bash
npx granular doctor  ./granular.options.mjs --strict
npx granular explain ./granular.options.mjs XButton
npx granular why-css ./granular.options.mjs text-red-500
```

Full reference: [The `granular` CLI](../../docs/en/cli.md).

## License

See [LICENSE](./LICENSE).
