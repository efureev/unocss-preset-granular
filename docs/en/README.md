# `@feugene/unocss-preset-granular` — documentation

A universal UnoCSS preset that aggregates styles, themes and `safelist` from an
arbitrary number of **granular providers** (component packages). The preset is
not aware of any specific UI package — it works on top of the public
`GranularProvider` contract. The end application decides in its `uno.config.ts`
which components and themes to pull in; providers declare what they ship.

> 🇷🇺 Русская версия: [`../ru/README.md`](../ru/README.md).

## Who is this for

- **Application authors** — you have an app and want to pull in components
  from one or more component packages (providers) without hand‑maintaining a
  `safelist`, without re‑declaring CSS tokens, and without shipping classes of
  components you don't use. → [Usage in applications](./usage-in-apps.md).
- **Component package authors** — you maintain a package of UI components and
  want to expose it as a first‑class provider (safelist, dependencies, themes,
  tokens) for any UnoCSS app downstream. →
  [Authoring providers](./authoring-providers.md).

## Table of contents

1. [Getting started](./getting-started.md) — install, minimal `uno.config.ts`,
   first render.
2. [Installation & wiring](./installation.md) — which `package.json`
   section (`dependencies` / `devDependencies` / `peerDependencies`) to
   use for the preset in applications and in provider packages.
3. [Usage in applications](./usage-in-apps.md) — full options reference,
   selecting components, themes, overrides, `granularContent` helper.
4. [Authoring provider packages](./authoring-providers.md) — component
   `config.ts`, provider `index.ts`, `packageBaseUrl` gotchas,
   `chunkFileNames` recipe for Vite‑built packages.
5. [Component scanning (`content.filesystem`)](./component-scanning.md) — how
   the preset discovers classes like `p-5` inside a provider component
   without `safelist`.
6. [Themes and tokens](./themes-and-tokens.md) — flat theme map, base/tokens
   CSS, `tokenDefinitionsFromCss*`, `strictTokens`.
7. [Architecture](./architecture.md) — two entries (`.` browser / `./node`
   build‑time), resolution pipeline, layers, preflights.
8. [Troubleshooting & recipes](./troubleshooting.md) — common pitfalls,
   arbitrary values, monorepo dev, HMR, `@apply` inside preflight CSS.

## What this preset does, in one paragraph

Given a list of `providers` (component packages that expose a
`GranularProvider` object) and a list of `components` the app actually uses,
the preset:

1. resolves the transitive `dependencies` graph of the selected components
   (including cross‑provider edges);
2. emits the needed `safelist` (only classes that live inside class bindings
   and can't be statically extracted);
3. at build‑time (`/node`) loads the relevant CSS files (base, tokens,
   per‑theme, per‑component styles) from disk and wires them into UnoCSS
   `preflights`;
4. tells UnoCSS to **scan the source files of the selected components** (and
   only those) via `content.filesystem` — so statically written classes like
   `class="p-5"` end up in the final CSS automatically;
5. merges optional `rules` / `variants` / `preflights` contributed by each
   provider in its `unocss` section.

The end result: **the template of a component is the single source of truth
for its classes** — the app doesn't duplicate them in `safelist`, and the
preset doesn't drag in components you didn't pick.
