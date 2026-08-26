# Strings and i18n

> See also: [Themes and tokens](./themes-and-tokens.md),
> [The `granular` CLI](./cli.md).

An application declares its package set exactly once — in `providers`. Which of
those packages ship dictionaries, under which subpaths and in which languages,
is known only to the build; the person who needs it is whoever writes
`createFintI18n({ loaders })`. Without a channel between the two, that list is
retyped by hand and silently drifts from the first one the moment a new
satellite package appears.

The preset publishes **addresses, not loaders**. It does not import a
dictionary, does not know the shape of an i18n runtime, and does not depend on
one. The consumer writes the imports — only they know what bundles their code.

## What a package declares

```ts
// src/granular-provider/index.ts
export const provider = defineGranularProvider({
  id: '@acme/ui',
  contractVersion: 1,
  packageBaseUrl: PACKAGE_BASE_URL,
  components: [...],
  i18n: {
    locales: ['en', 'ru', 'pt-BR'],
  },
})
```

`entry` defaults to `` `${id}/i18n` `` and `allEntry` to `` `${entry}/all` ``,
so a package that follows the convention declares nothing but its tags. Absence
of the whole `i18n` field means "this package ships no strings" — there is no
separate flag for that.

### Tags are not import names

`locales` holds **BCP 47 tags** — the top-level keys of the loader collections,
the strings the runtime matches against. Import names are a different thing:
`pt-BR` cannot be an identifier, so packages export it as `ptBR`. The preset
derives the name from the tag (hyphen dropped, next segment capitalised) and
lets a package override the derivation where it departs from the convention:

```ts
i18n: {
  locales: ['en', 'pt-BR'],
  // Only for tags whose export is spelled differently. A sparse override
  // over `locales`, never a second list of them.
  exportNames: { 'pt-BR': 'brazilian' },
}
```

A tag from which no valid identifier can be derived and which carries no
override is rejected at registration — the alternative is a syntactically
broken import generated inside someone else's application.

## Package layout

One module per locale. This is not the i18n runtime's requirement but the
**bundler's**: only this layout lets a consumer drop the languages it does not
ship.

```text
src/i18n/
  locales/en/…json
  locales/ru/…json
  en.ts          # exports `en` — English loaders only
  ru.ts
  index.ts       # barrel of named re-exports, no aggregate
  all.ts         # fat aggregate for demos and tooling
```

```ts
// src/i18n/en.ts
export const en = {
  en: {
    ui: () => import('./locales/en/ui.json'),
  },
}
```

```ts
// src/i18n/index.ts — `all` is NOT re-exported from here: it would drag
// every language back into the graph of anyone writing `import { en }`.
export { en } from './en'
export { ru } from './ru'
```

```jsonc
{
  "sideEffects": false,
  "exports": {
    "./i18n":     { "types": "./dist/i18n/index.d.ts", "import": "./dist/i18n/index.js" },
    "./i18n/all": { "types": "./dist/i18n/all.d.ts",   "import": "./dist/i18n/all.js" }
  }
}
```

`./i18n` and `./i18n/all` are **separate** entries, and `sideEffects` must not
cover the locale modules — otherwise the bundler treats each of them as
side-effecting and refuses to drop it. `granular doctor` verifies that the
declared subpaths really are in `exports`; everything else here is on the
package author.

## The manifest

```ts
// vite.config.ts — the same options object the preset gets, so the manifest
// and the CSS are built from one resolution and cannot drift apart.
import { granularI18nPlugin } from '@feugene/unocss-preset-granular/node'

plugins: [
  UnoCSS(),
  granularI18nPlugin(granularOptions, { locales: ['en', 'ru-RU'] }),
]
```

```ts
// vite-env.d.ts — the type comes from `/runtime`, not `/node`: this is browser
// code, and importing the node entry for a type drags `node:fs` into the bundle.
declare module 'virtual:granular-i18n' {
  import type { GranularI18nManifest } from '@feugene/unocss-preset-granular/runtime'

  const manifest: GranularI18nManifest
  export default manifest
}
```

```ts
// main.ts — imports are written by hand (or generated); the manifest says which.
import manifest from 'virtual:granular-i18n'
import { en, ru } from '@acme/ui/i18n'

const i18n = createFintI18n({
  locale: 'ru-RU',
  // Order matters: donors come before dependents, and loaders merge left to right.
  loaders: [appEn, appRu, en, ru],
})
```

`getGranularI18nManifest(options, …)` returns the same structure without a
plugin, for configs that would rather `define:` it themselves.

### What a binding carries

Each entry carries **bindings** rather than a flat locale list, because "what
the app asked for" and "what to import" are different strings:

| Field | Meaning |
|---|---|
| `locale` | The declared tag — the top-level key of the loader collection. |
| `exportName` | What to write in the import: `ptBR` for the `pt-BR` tag. |
| `serves` | Requested tags this one binding covers. |
| `via` | How it was found: `exact`, `base` or `region`. |

Alongside them, `manifest.locales` is the union of declared tags that will
enter the bundle — the `available` list for `negotiateLocale` — and
`manifest.unserved` names requested tags no package serves at all. Nowhere else
is that visible: at runtime the negotiation simply falls back.

## Locale matching

Coverage is not string equality. Each requested tag runs a cascade that stops
at the first hit, so exactly one declared tag is selected per requested tag and
one dictionary can never be imported twice:

| Step | Rule | Example |
|---|---|---|
| `exact` | Case-insensitive match; the package's own spelling wins. | `ru` ← `ru` |
| `base` | The requested tag's base language. | `ru` ← `ru-RU` |
| `region` | The reverse step: only a regional variant is declared. | `ru-RU` ← `ru` |

### Why the reverse step exists

The manifest decides what enters the bundle, and that is a question of
*availability*. Without the third step a package declaring only `ru-RU` drops
out of a build that asked for `ru`, and runtime negotiation can no longer pick
what it otherwise would: a locale absent from the bundle is absent from
`getAvailableLocales()`. When several regional variants qualify, the first in
declaration order is taken and a `console.warn` names the rest — at build time
an arbitrary region is a decision, not a detail.

## Checking it

```bash
granular doctor uno.config.ts --strict
```

The report lists each provider's locales and raises `i18n-subpath` when a
package declares an address its own `exports` do not expose. That failure
otherwise surfaces in the *consumer's* build as `Failed to resolve import`,
naming an application whose author wrote none of it.

## What is deliberately absent

**Block names.** A block name already lives inside the loader collection as its
second-level key, so a field here would be a second source of truth and would
drift. The price is stated rather than hidden: two packages claiming one block
cannot be detected at build time — which is fine, because a shared block is an
ordinary left-to-right loader merge, not an error.

**Loader functions.** A provider module is evaluated inside the consumer's
config. A function there would drag every locale JSON into that graph and would
resolve relative to the provider rather than the application bundle.
