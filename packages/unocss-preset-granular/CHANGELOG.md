# Changelog

All notable changes to `@feugene/unocss-preset-granular`.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions are `0.x`, so **a minor bump may carry breaking changes** — each one
below says so explicitly.

What "breaking" means here, in decreasing order of blast radius:

1. **The provider contract** (`GranularProvider`, `GranularComponentDescriptor`)
   — breaks other people's packages. Guarded by `GRANULAR_CONTRACT_VERSION`,
   still `1` since the beginning.
2. **The preset options** (`PresetGranularOptions`) — breaks applications.
3. **The CLI report types** (`DoctorReport`, `ExplainReport`, `WhyCssReport`,
   `TokensReport`)
   — breaks tooling that reads them. These grow in minor versions by design;
   see [Report stability](https://github.com/efureev/unocss-preset-granular/blob/main/docs/en/cli.md).

Entries before `0.7.0` were reconstructed from git history and release tags —
they summarise what shipped, not what was written down at the time.

## [Unreleased]

## [0.15.0] - 2026-08-28

Правки по `BUGS.md` — фидбеку потребителя (`@feugene/granularity`, 78 компонентов)
против 0.14.1. Обе его находки и одна найденная при разборе — один корень:
**0.14.0 схлопнул три ответа про значение токена в один, но только для
структурных слоёв.** Для CSS, который пресет инлайнит целиком, оставалось два
независимых прохода.

### Fixed

- **`token-undefined` был слеп к `themes.tokensFile` / `baseFile`.** Эмиссия
  ЗАМЕНЯЕТ провайдерский файл при app-override, а диагностика складывала оба в
  одно множество «заданного»: токен, снесённый подменой, оставался для неё
  заданным. На реальном приложении подмена `tokens.css` роняла theme-CSS с 22 504
  до 15 703 байт, одиннадцать переменных разрешались в пустоту — при зелёной
  сборке и молчащем `doctor`. Правка 0.14.1 добавила `themeFiles` в тот же цикл
  сложения и потому дыру не закрыла.
- **`granular tokens` не знал про инлайнимый CSS вовсе.** Провайдер, отдающий
  палитру обычным `tokens.css`, получал отчёт, где ВЕСЬ его набор лежит в группе
  «not defined by any granular layer» — команда, задуманная как ответ на «где мои
  токены, а где общие», не отвечала ни на что.
- **Доктор читал `provider.theme.themes[name]`, не глядя на `tokenDefinitions`.**
  `resolveThemes` разводит их через `else if`: структурная тема вытесняет
  файловую, и файл в CSS не уезжает. Доктор разбирал файл-призрак и добавлял его
  токены в «заданные».
- **`pickThemeUrl` подписывал app-override как `provider '<id>'`.** Пока метка
  влияла только на текст `GranularCssReadError`, это было косметикой; теперь из
  неё выводится происхождение токена в отчёте.
- Нечитаемый инлайнимый CSS больше не гасится молча: его токены не попадут в
  «заданные», и каждый потребитель получил бы ложную находку без следа причины.

Раскладка инлайнимых файлов вынесена в `node-utils/inlinedCss.ts`
(`resolveInlinedCssSources`) — из неё берут и эмиссия, и обе команды. Обход идёт
по `resolution.themes.items`, что закрывает третью находку по построению.

### Added

- `TokensUsage.inlined` — значения токена, пришедшие из инлайнимого CSS, с
  селектором и файлом-источником. Отдельным полем, а не слоем в `values`: слоя
  такой файл не образует, `tokenOverrides` до него не дотянется, пока провайдер
  не поднимет его через `tokenDefinitionsFromCss`.
- Токены инлайнимого CSS попадают в группы `provider` / `app` по владельцу файла.

### Note

`doctor` теперь находит больше — это цель правки, но CI на `--strict` может
покраснеть на первом апгрейде. Новая находка по-прежнему двигает `clean`, не
`ok`; красный `--strict` означает настоящий незаданный токен.

## [0.14.1] - 2026-08-28

Правки по итогам ревью 0.14.0. Три из них — про то, что новая проверка красила бы
CI на верной конфигурации; две — про расхождение, которое 0.14.0 как раз объявил
закрытым.

### Fixed

- `token-undefined` больше не выдаётся на потребление с fallback. `var(--x, 8px)`
  рисует корректно без единого слоя, дефектом не является, а `doctor --strict`
  на нём краснел. Запись в `undefinedTokens` остаётся: «слоя нет, но есть
  запасное значение» — факт, который отчёт обязан показать.
- `token-undefined` учитывает `themes.themeFiles`. Именно он решает, какой файл
  темы уедет в CSS; без него доктор разбирал провайдерский оригинал, а ругался
  на подменённый.
- Токен, у которого все слои отброшены `strictTokens`, получает `origin: 'none'`
  и попадает в `undefinedCount`. Раньше `granular tokens` называл его пришедшим
  от приложения, а `doctor` — неопределённым: два ответа про один токен.
- Объявление одноимённого компонента ЧУЖОГО провайдера больше не приписывается
  цели как своё. Слой компонента несёт квалифицированный `componentKey`; поле
  `source` не менялось — его формат зафиксирован в `DoctorTokenConflict.sources`.
- Манифест тем берёт селекторы из той же раскладки, что и значения. Вложенная
  форма `tokenOverrides` создаёт блок под новым селектором, он эмитится в CSS, а
  манифест о нём не знал — переключатель не мог активировать существующую тему.
  Тема, собранная одними overrides, теперь тоже несёт токены.
- CSS-файл, объявленный несколькими компонентами, атрибутируется всем.
  `resolution.cssFiles` дедуплицирован по URL и хранит только первого объявителя,
  из-за чего потребление второго компонента исчезало из отчёта.
- Неоднозначное короткое имя больше не печатается как «такого компонента никто
  не объявляет»: отчёт различает `ambiguous` и `unknown` и просит
  квалифицировать имя.

### Performance

- Общая директория группы читается один раз, а не по разу на каждого члена
  группы: шесть членов давали шестикратное чтение общих файлов внутри
  синхронного `doctor`, а `scanned.sourceFiles` выдавал больше файлов, чем их
  существует.
- Построение индекса потребления линейно: дедуп через `Array.includes` был
  квадратичным по числу файлов, в которых встречается токен.
- `doctor` считает раскладку слоёв один раз на прогон вместо двух.
- Форматтер `tokens` считает размеры групп одним проходом.

## [0.14.0] - 2026-08-28

### Added

- **`granular tokens <options-file> <Component> [--deep]`** — which theme tokens a
  component needs. It separates the component's own tokens from the shared ones it
  merely consumes, groups them by origin (`own` / `component` / `provider` / `app` /
  `none`), prints the full layer chain behind every value, and lists which other
  selected components use the same token. `--deep` extends the scope to the
  component's transitive `dependencies`, so a token published by a sub-component
  shows up as `declared by another component`.

  Consumption is found through three channels: `safelist` (pure resolution data),
  declared `cssFiles`, and the component's scanned sources. The `safelist` channel
  is not an optimisation — classes assembled outside the component's directory land
  in a shared chunk that neither the extractor nor a directory scan can see, which
  is exactly why such components declare a `safelist` in the first place.

- **`token-undefined` diagnostic** (`warn`) and `DoctorReport.undefinedTokens` — a
  component consumes a token no granular layer defines for any active theme.
  `var(--x)` without a fallback is valid CSS that silently paints nothing. The level
  is `warn` for the same reason `undeclared-dependency` is: the token space is open,
  and the value may legitimately come from UnoCSS rules, `provider.unocss` or the
  application's CSS. Tokens declared by inlined `tokensCssUrl` / `baseCssUrl` /
  theme files are excluded.

- `granularTokens` / `formatTokensReport` and their report types are exported from
  `/node`.

### Fixed

Three separate answers to "what is this token's value" collapsed into one. The
preset now computes the emitted CSS, every report and the theme manifest from the
same layer resolution, so a report cannot name a value the build does not produce.

- `ExplainReport.tokens[].effective` ignored `themes.tokenOverrides`: it read
  `tokenRegistry`, which the fourth layer never enters. On any app that overrode a
  component token, `explain` printed the pre-override value and `overridden: false`.
- `getGranularThemeManifest(…, { includeTokens: true })` had the same defect, and it
  broke the manifest's stated invariant — selectors agreed with the CSS, values did not.
- `doctor` reported token conflicts without accounting for `strictTokens`, so an
  override the generator had discarded could still be named as the final value.
  Discarded layers are now visible as such instead of silently winning.

## [0.13.0] - 2026-08-26

**Breaking: `GranularProvider.i18n` and the string manifest are removed.** A provider
declaring `i18n` still registers — the field is simply ignored — but
`getGranularI18nManifest`, `granularI18nPlugin`, `virtual:granular-i18n` and the manifest
types are gone. Nothing in the ecosystem consumed them: the ring never adopted the field,
and the one application that read the manifest is migrated below.

### Removed

- **`GranularProvider.i18n`, `GranularI18nContribution`** and the four
  `invalid-i18n-*` validation reasons.
- **`getGranularI18nManifest`, `granularI18nPlugin`, `GRANULAR_I18N_MODULE_ID`** and the
  manifest types exported from `/runtime`.
- **`i18n-subpath`** doctor diagnostic and the locales column in its provider report.
- `docs/{en,ru}/strings-and-i18n.md` and SPEC §3.3.

The field answered "which packages ship strings, at which subpaths, in which languages" so
a framework integration could generate per-locale imports instead of keeping its own
registry. Measured against a real consumer, that turned out to be **convenience rather
than capability**: a block name lives inside the loader collection as its second-level key,
so an integration derives it from data it has already imported, and the package list is one
line the application writes anyway. The preset was answering a question its callers could
answer themselves — while introducing a model that does not hold: a block is an open
namespace, and an application may add a language to a package's block without the package
knowing. `manifest.unserved` reported such a language as unserved, which is the opposite of
the truth.

### Kept

- **`@feugene/simple-package` still ships four locales** (`en`, `ru`, `pt-BR`, `es`) and
  `apps/app-5` still imports three of them by name. `verify:apps` still asserts that the
  fourth is **absent** from the bundle. That check never depended on the contract, and it
  is the only place where per-locale tree-shaking is proven by a build rather than by
  documentation.

## [0.12.0] - 2026-08-26

Not breaking: `i18n` is an optional field, so `GRANULAR_CONTRACT_VERSION` stays
`1` — per §2, adding an optional field does not bump it. Raising the version
would have been worse than useless: `expandProviders` compares it by strict
equality, so a provider declaring `2` would be rejected outright by every
released preset.

### Added

- **`GranularProvider.i18n`** — the subpaths, locale tags and export names a
  package publishes its strings under. This closes a gap that forced every
  framework integration to keep its own hardcoded registry of "which package
  ships strings, and where": the application already declares its package set
  once, in `providers`, and now that declaration answers the question. The
  hand-written `loaders: [appEn, appRu, granularityEn, granularityRu]` of the
  `fint-i18n` installation guide is exactly that second registry.

  The contribution carries **addresses only**. Loader functions must not go in:
  the provider module is evaluated inside the consumer's config, so a function
  would drag every locale JSON into that graph and would resolve relative to the
  provider rather than to the application bundle.

  `locales` holds **tags, not import names**. The two are not the same string
  for regions — `pt-BR` cannot be an identifier and is exported as `ptBR` — so
  the name is derived from the tag and `exportNames` overrides the derivation
  where a package departs from the convention. A tag from which no identifier
  can be derived is rejected at registration rather than becoming a broken
  import in someone else's build.

  **Block names are deliberately absent.** A block name already lives inside the
  loader collection as its second-level key, so a field here would be a second
  source of truth for one value and would drift. The consequence is stated
  rather than hidden: two packages claiming the same block cannot be detected at
  build time — which is fine, because `fint-i18n` treats a shared block as an
  ordinary left-to-right loader merge, not an error.

- **`getGranularI18nManifest(options, { locales?, onlySelected? })`** and the
  matching **`granularI18nPlugin`** serving `virtual:granular-i18n`. Built from
  the same memoised resolution that emits the CSS, so the manifest cannot drift
  from the build. Modelled on the theme manifest, including the structural
  `GranularVitePlugin` type that keeps Vite out of the dependencies.

  Each entry carries **bindings** rather than a flat locale list: what to import
  (`exportName`), which declared tag it is (`locale`), which requested tags it
  covers (`serves`) and how it was found (`via`). A flat list could not be both
  "what the app asked for" and "what to import", and could return `ru` and
  `ru-RU` at once — two imports of one dictionary. Bindings cannot: the cascade
  stops at the first hit, and bindings collapse by declared tag.

  The cascade mirrors `negotiateLocale` — exact, then base language, then the
  **reverse step** (`ru` requested, only `ru-RU` declared). The reverse step is
  the one `LoaderRegistry.resolve` does not do, and it belongs here because the
  manifest decides *availability*: without it the package drops out of the
  bundle and runtime negotiation cannot pick what it otherwise would. An
  ambiguous reverse step (`ru-RU` and `ru-BY` both qualifying) picks the first
  in declaration order and says so through `console.warn` — at build time an
  arbitrary region is a decision, not a detail.

  `manifest.unserved` lists requested tags no package serves at all. Nowhere
  else is that visible: at runtime `negotiateLocale` simply falls back.

- Manifest types are exported from **`/runtime`** as well, for
  `declare module 'virtual:granular-i18n'` in the application. Types only —
  matching is precomputed at build time, so a browser bundle never needs to
  import `/node` (and `node:fs` with it) to reason about locales.

- `InvalidProviderError` reasons `invalid-i18n-contribution`,
  `invalid-i18n-locales`, `invalid-i18n-entry` and `invalid-i18n-export-name`,
  raised at registration. These defects otherwise surface in the *consumer's*
  build and in the wrong package: an empty `locales` silently loses per-locale
  tree-shaking, a repeated tag doubles an import, a padded specifier resolves to
  nothing, and a broken subpath reads as `Failed to resolve import` in an
  application whose author did not write it.

- `granular doctor` now reports the locales of each provider's contribution and
  gains the `i18n-subpath` diagnostic: a package declaring a subpath its own
  `exports` do not expose fails the *consumer's* build with `Failed to resolve
  import`, naming an application whose author wrote none of it. Registration
  cannot check this — resolving modules is the bundler's job — but `doctor` has
  the filesystem and the package identity, so it can. It stays silent wherever
  certainty is impossible (non-`file:` base URL, unmatched `package.json`,
  absent `exports`, pattern keys), because a false positive fails CI under
  `--strict`.

- `unused-provider` no longer fires for a package whose only contribution is
  strings. Previously such a satellite was declared useless, and acting on that
  advice would have cost the application every dictionary it shipped.

### Verified

- `@feugene/simple-package` now ships strings — four locales including `pt-BR`
  (tag and export name differ) and one, `es`, that no application requests.
  `apps/app-5` consumes the manifest, and `verify:apps` gained a `js` section:
  it asserts the manifest reached the bundle, that the `ru-RU` request bound to
  the package's `ru`, and that the `es` dictionary is **absent**. Per-locale
  tree-shaking was documentation until now; it is a check that fails when
  broken.


## [0.11.0] - 2026-08-23

Not breaking: flat layouts generate exactly as before, and `entryFor` gains a
second argument that existing implementations simply ignore.

### Fixed

- **`/codegen` now sees the grouped layout it prescribes itself.** The docs call
  `src/components/<group>/<Component>/` canonical — that is how a group's shared SFC
  lands inside the scan area — while the collector did a single `readdir` over the
  root. A run *without* `--check` therefore did not merely skip grouped components:
  it stripped them from all four registries at once — barrel, `exports`, build
  entries and the provider registry. A destructive result from the standard command.

  A directory whose name does not start with the prefix is now treated as a group
  and walked one level deep. Deliberately one: the canon describes exactly one level,
  and recursion would drag `shared/` and `__tests__/` into the registries.

### Added

- **`collectGranularComponentEntries`** returns `{ name, dir }`: the name stays flat —
  subpaths and config imports are keyed by it — while the path carries the group.
  `GranularCodegenContext` gains `componentPath`, so a provider's own target can build
  the same paths.

- **`duplicate-component-name`** — a new `GranularCodegenError` reason. Registry entries
  are keyed by name, so two components sharing one would have let one silently win.

### Changed

- `packageExports` passes the component's path to `entryFor` as a second argument; the
  built-in default now uses it. A one-argument implementation keeps working.

### Documentation

- **The advice to build `packageBaseUrl` by runtime concatenation is gone.** Three pages
  carried it — scanning, troubleshooting and the authoring checklist — while a fourth
  documented `resolvePackageBaseUrl`, available since 0.5.0. All of them now name the
  helper and add the reason the consumer actually needs: it must be called from the
  **entry file**, because a shared module is placed at whatever depth the bundler
  chooses, and the base then drifts a level with the scan silently emptying.


## [0.10.1] - 2026-08-22

### Fixed

- **`packageExports` no longer strips a component's neighbouring subpaths.** The run
  it rewrites was recognised by `key.startsWith(keyPrefix)`, so
  `./components/GrAlert/styles.css` and the pattern `./components/*/styles.css`
  counted as component keys: they were swallowed by the run and never written back.
  The package silently lost a published subpath and the consumer found out at build
  time, with `ERR_PACKAGE_PATH_NOT_EXPORTED` — the very failure the generator exists
  to prevent. A component key is now exactly `<keyPrefix><Name>`: one segment, no
  wildcard. Anything deeper or patterned belongs to the package and stays put, the
  way `.` and `./contract` do; once the run is rewritten such keys sit after it and
  stay there on every later run.

  Consequence worth knowing: a `package.json` whose only component-ish key is a
  nested one now fails with `no-component-exports` instead of anchoring the run to
  it. The anchor has to be a real component subpath.

## [0.10.0] - 2026-08-22

Not breaking: the new option is off by default, so a provider's `package.json`
does not change from the upgrade alone.

### Added

- **`codegenTargets.packageExports({ subcomponents: true })` — subpath aliases for
  parts of composite components.** `GrTimelineItem`, `GrListItem`, menu items live in
  the parent's directory and are not public components: no `index.ts`, no `config.ts`,
  and their code ships in the parent's chunk. They need no entry of their own — but
  without a subpath `@feugene/kit/components/GrTimelineItem` fails with
  `ERR_PACKAGE_PATH_NOT_EXPORTED`, so granular imports never reach those names, even
  though a template spells them like any other component. The alias keeps the part's
  key and points at the parent's module.

  A part is recognised by the parent's barrel (`export { default as GrX } from
  './GrX.vue'`) — including from a subdirectory (`parts/GrX.vue`) and under either
  quote style; a re-export under a different name is not an alias, since the subpath
  would point at a module that holds no such file. The name must carry the package
  prefix, so a barrel's internals (`TableCell`) stay out of the public API.

- **`subcomponent-name-clash`** — a new `GranularCodegenError` reason: the name of a
  part is already taken by a component of its own, or by a part of another parent.
  One subpath cannot serve two modules, and choosing a winner silently would have
  re-pointed a component's own subpath at its parent's chunk while leaving its build
  entry in place.

- `collectGranularSubcomponents` and `parseSubcomponents` are exported from
  `./codegen`, and `GranularCodegenContext` now carries `subcomponents`: a provider
  with its own target can build the same map without duplicating the rule.

## [0.9.1] - 2026-08-12

### Fixed

- **`/codegen` could not bootstrap a freshly scaffolded provider.** The very
  first run of a package that has no components yet failed with
  `no-component-exports`: `packageExports` looks for an existing component
  subpath to anchor the generated run to, and a new package has none. Having no
  anchor *and* no components is now a no-op — the combination is what makes it
  benign. A missing anchor with components present still raises, because staying
  silent there would drop them from `exports`.

- **A missing components directory now raises `missing-components-dir`** instead
  of a bare `ENOENT`. It is deliberately not treated as "zero components": a
  typo in `componentsDir` would then pass quietly and strip every registry. An
  empty but existing directory remains the legitimate bootstrap case.

## [0.9.0] - 2026-08-12

### Added

- **`/codegen` — generation of a provider's component registries.** New subpath,
  Node-only (it touches the file system), like `/node` and `/vite`. Nothing in
  the existing API changes.

  A provider lists its components in several places at once — the root barrel,
  the `exports` subpaths, the build entries, the provider's own registry — and a
  companion package adds two more: the auto-import resolver whitelist and the
  list feeding `granularAssetFileNames`. Missing one never fails a build:
  tree shaking, a subpath import or the class scan breaks on its own, silently.
  `@feugene/granularity` had carried a private copy of this generator since the
  day its four lists had already drifted; a second companion package would have
  meant a second copy.

  - `runRegistryCodegen({ packageDir, targets, check })` — collects components
    from the file system and applies every target, accumulating edits per file
    so that two targets on one file compose instead of overwriting each other.
  - `codegenTargets` — ready-made `barrel`, `viteEntries`, `packageExports`,
    `providerRegistry`, plus the generic `markedBlock` that covers whatever a
    package has beyond them.
  - `prefix` and `configExportName` are options: a package whose components are
    not `Gr*` needs no generator of its own.
  - Primitives are exported too (`collectGranularComponents`,
    `replaceMarkedBlock`, `replacePackageExports`) for a provider that wants to
    assemble its own pipeline.
  - Every rejection is a `GranularCodegenError` with a machine-readable
    `reason` and the `file` it stopped on, so a caller can tell "the registries
    drifted" from "the tooling itself broke" (SPEC §11).

  In TypeScript files only the marked block is rewritten, keeping its own
  indentation; `package.json` cannot carry markers, so the contiguous run of
  component keys is replaced in place and every other export stays where it was.
  `check: true` writes nothing and reports which files drifted — that is the
  gate a package runs from its test suite.

- **The `font-variant-numeric` family is now part of the `includeExtraRules`
  set** (`numericRules` + `numericPreflights` in
  `@feugene/unocss-mini-extra-rules`). `tabular-nums`, `ordinal`,
  `slashed-zero`, the fraction and figure-style utilities and the `normal-nums`
  reset all live in `presetWind*` only, so a component writing `tabular-nums`
  kept the class in the markup with no CSS behind it — a column of numbers
  reflowed on every change of value. The preset registers the preflight
  alongside the rules; without it the property would be assembled from
  undefined variables.

- The dependency floor moved to `@feugene/unocss-mini-extra-rules` 0.8.1: 0.8.0
  registers `@property` under a stale variable prefix after `uno.setConfig()`
  (a `uno.config.ts` edit with the dev server running), and its numeric rules
  shadow `presetWind3`'s without carrying its `preflightKeys`.

## [0.8.1] - 2026-08-10

### Added

- **`sr-only` / `not-sr-only` are now part of the `includeExtraRules` set**
  (`accessibilityRules` in `@feugene/unocss-mini-extra-rules`). Like the
  `text-transform` family, the pair lives in `presetWind*` and is absent from
  `presetMini`, so a component writing `sr-only` kept the class in the markup
  with no CSS behind it — the "visually hidden" label was simply visible, and
  nothing in the build said so.

  Declarations mirror `presetWind*` one for one: with both loaded, UnoCSS
  resolves to the last matching rule, so a divergence here would make the
  emitted CSS depend on preset order.

- **`object-fit` / `object-position` are now part of the `includeExtraRules`
  set** (`objectRules` in `@feugene/unocss-mini-extra-rules` 0.7.0). Same silent
  failure as the pair above: `object-cover` stayed in the markup while the image
  was stretched instead of cropped.

- **`granular doctor` now reports token keys declared with the `--` prefix**
  (`token-prefix`, level `warn`). The generator adds the prefix itself, so
  `'--brand'` emits a valid but useless `----brand` custom property and the
  theme silently loses the value — the single most documented trap of the
  contract (SPEC §6.1) used to pass `doctor` with `clean: true`.

- **Typed error classes for every remaining bare `Error`**: a malformed
  selection key now raises `InvalidComponentKeyError` (exported from `.`);
  a non-`file:` CSS URL or a malformed `data:` URL raises
  `GranularCssSourceError`; strict token-parse failures raise
  `GranularTokenParseError` with a machine-readable `reason` (both exported
  from `./node`); a CLI options file without the expected export raises
  `GranularOptionsLoadError`. Messages are unchanged — only the classes are
  new. SPEC §11 lists the new rows.

- **`InvalidProviderError` and `InvalidProviderReason` are now exported from
  the root entry.** The class was thrown since 0.6 but never re-exported, so
  consumers could not `instanceof` it.

### Changed

- **Breaking (report types):** `DoctorDiagnosticCode` gained `'token-prefix'`.
  Treat the union as open — same policy as in 0.7.0.
- **`tokenDefinitionsRef` are now materialized only for themes that can become
  active** (the active set of §6.2 plus transitive `extends` bases). A broken
  reference belonging to a theme the build never requested no longer fails
  config loading — and its file is no longer read at all. References of
  active themes still fail loudly with `GranularTokenRefError` (SPEC §6.4).
- **SPEC §9 corrected to match the shipped code:** the `./vite` entry is
  build-stage code and carries static `node:` imports
  (`granularCssAssetsPlugin` reads and writes the filesystem); the naming
  callbacks remain pure. Importing `./vite` from browser-reachable code is
  now explicitly forbidden, same as `./node`, and the conformance grep in
  §9/§12 covers both entries.

- **The entire user-facing surface now speaks English**: the text reports of
  `doctor` / `explain` / `why-css`, `diagnostics[].message`, the CLI usage and
  its errors, the runtime-controller errors and every `console.warn`. The
  structured (`--json`) report shapes are unchanged. Anything that matched the
  Russian text of the reports must update — the text format was never a stable
  API; parse `--json` instead.

### Fixed

- **A raw NUL byte in `src/vite-utils/cssAssets.ts`** (the dedupe key inside
  `planGranularCssAssets`) made git, `grep` and `file` treat both the source
  file and the built `dist/vite.js` as binary: diffs showed "Binary files
  differ", and the grep-based boundary checks from SPEC §9 silently matched
  nothing on those files. The byte is now written as the `\0` escape; runtime
  behaviour is unchanged.

- **`getGranularComponentCss` now wraps read failures in
  `GranularCssReadError`** naming the provider and the component, like every
  other CSS-reading path. It was the last place where a missing file produced
  a bare `ENOENT` with an absolute path and no culprit.

- **`sideEffects` corrected to `false`.** The old `["**/*.css"]` matched
  nothing — the package publishes no CSS files — and misleadingly declared
  assets that do not exist. Tree-shaking behaviour is identical.

- **`lib: ["DOM"]` removed from `tsconfig`.** The `/runtime` entry documents
  that it does not depend on `lib.dom` (structural types only); the compiler
  now enforces that instead of relying on discipline.

- **The contract JSDoc of `cssFileAssetNames`** claimed a length mismatch
  "silently disables the fallback for the tail" — in fact registration raises
  `InvalidProviderError('css-files-length-mismatch')` (SPEC §4.2). The comment
  described behaviour the package left behind.

- **The `strictTokens` JSDoc** said it "forbids" overriding tokens unknown to
  the providers — it actually skips such an override with a `console.warn`
  while the build continues. The comment now states the real behaviour
  (`docs/{en,ru}` described it correctly all along).

## [0.7.0] — 2026-08-05

### Added

- **`granular doctor` now compares the declared dependency graph against what
  the provider actually ships.** Every import that lands in another component's
  directory without being reachable through `component.dependencies` is
  reported as `undeclared-dependency`.

  The gap it closes was silent in every other channel: a bundler never reads
  `dependencies`, so a missing edge costs the provider nothing at build time.
  The preset scans `components/<Name>/` and merges `safelist` only for
  components in the selection, so an application selecting just the outer
  component never scans the inner one — the nested component renders with no
  background and no focus ring. The provider builds, the types are intact, the
  app builds, and only whoever picked that particular selection ever sees it.

  Detection reads the emitted `.js` of the selected components and walks
  **through** the package's non-component files (`chunks/`,
  `groups/<group>/shared/`): `A → shared → B` is as much an edge as a direct
  import, and invisible if you only look at direct ones.

- `DoctorReport.undeclaredDependencies` and the exported type
  `DoctorUndeclaredDependency` (from `./node`).
- A "Undeclared dependencies" section in the `doctor` text report.

### Changed

- **Breaking (report types):** `DoctorDiagnosticCode` gained
  `'undeclared-dependency'`. An exhaustive `switch` with a `never` branch over
  this union stops compiling. Treat it as an open union.
- **Breaking (report types):** `DoctorReport` gained the required field
  `undeclaredDependencies`. Code that constructs a `DoctorReport` by hand (a
  test mock) stops compiling. Take the report from `granularDoctor` instead.
- **Breaking (behaviour):** `report.clean` can now be `false` where it was
  `true`. `report.ok` is unaffected — the new diagnostic is `warn`, so a
  default `doctor` run still exits `0`, but `doctor --strict` in CI will go red
  on a provider whose graph has drifted. That is a real finding, not an API
  break.
- The `dependencies` criterion is now written down where it is actually needed:
  in the JSDoc of both contract types (`DefineGranularComponentOptions` had no
  JSDoc at all), as a normative **MUST** in `docs/SPEC.md` §4.1, and as a
  "`dependencies` — critical" block in `docs/{en,ru}/component-authoring.md`.
  Previously the only statement of intent lived in one table cell — "only
  components your template truly depends on" — which is both too narrow (an
  import from `<script setup>`, a composable or a dynamic `import()` is just as
  much an edge) and silent about the converse: importing a constant or a type
  from another component's directory is **not** a dependency, and declaring it
  ships the donor's entire CSS and safelist to every consumer.

### Notes on the check

- **It ignores the current selection for targets, not for sources.** A target
  may happen to be selected for another reason — the CSS of that build is then
  correct, but the declaration is still wrong and the next consumer pays. Were
  it selection-aware, `components: 'all'` would never report anything. Sources,
  however, are the selected components only: as a provider author, run `doctor`
  with `components: 'all'`.
- **Level is `warn`, not `error`, because the finding is heuristic** — a
  regular expression over the text of the bundle, not an AST. That is not a
  safety net: `--strict` fails on a `warn` exactly as on an `error`.
- **Known limits, deliberately fixed rather than left to guesswork:** `.cjs` is
  not scanned at all (`require()` is not parsed, and a silent zero is worse
  than an honest "not checked"); a dynamic `import()` with a template string is
  not resolved; a specifier inside a string literal is counted as an import.
  Cross-package edges are matched at one deterministic position — right after a
  `components` segment, otherwise the first segment — so a path like
  `@pkg/utils/Button/…` no longer yields an edge and the result no longer
  depends on the order of `provider.components`.

### Migration

No action for provider or application code. Two things to check:

1. If you read `DoctorReport` from code, see the breaking notes above.
2. Run `granular doctor --strict` with `components: 'all'` against your
   provider before publishing. A reported edge that renders nothing is a false
   positive, not a missing dependency — do not declare it.

## [0.6.2] — 2026-08-04

### Added

- Typography support in the bundled extra rules.

## [0.6.1] — 2026-08-04

### Added

- `includeExtraRules` option for opting into `@feugene/unocss-mini-extra-rules`
  from the preset.

### Changed

- Dependency updates.

## [0.6.0] — 2026-08-03

### Added

- `granularCssAssetsPlugin` in the `./vite` entry, for CSS assets declared by a
  provider.

### Changed

- README rewritten around installation, usage and migration.

## [0.5.0] — 2026-07-30

A large release; the preset became a tool rather than just a preset.

### Added

- `granular explain` and `granular why-css` alongside `doctor`, with structured
  reports (`ExplainReport`, `WhyCssReport`).
- `tokenDefinitionsRef` — theme tokens by reference to a CSS custom property
  block, resolved in the node layer.
- `resolvePackageBaseUrl()` — the safe way to compute `packageBaseUrl`
  (`new URL('..', import.meta.url)` is rewritten to a `data:` URL by rolldown,
  which silently collapses the scan).
- App-owned themes and runtime theme switching, exercised end-to-end by the
  reference apps.

### Changed

- Layers restructured, the `./vite` entry expanded.
- Provider validation moved into `expandProviders` with typed errors.
- Caching of resolution, scan inspection and CSS reads keyed on options
  identity.

## [0.4.0] — 2026-07-17

### Added

- `granular doctor` — the first diagnostic command: providers, the selected
  component graph, theme token blocks, token conflicts, scan globs and
  layout-contract violations.
- `expandDirectives` option for the preflight CSS.
- Runtime debugging via `DEBUG` (`createDebug`).

### Changed

- Stricter provider validation.

## [0.3.0] — 2026-05-05

### Added

- The group-shared SFC contract: `<packageBaseUrl>/groups/<group>/shared/` is
  scanned for components declaring `group`.

### Changed

- `safelist` in the component contract is now optional.

## [0.2.3] — 2026-05-05

### Removed

- **Breaking (contract):** the deprecated `sourceDir` / `sourceDirUrl` options
  of the component contract. Component sources are located through the layout
  contract (`components/<Name>/`), not by a declared path.

## [0.2.0] — 2026-04-22

### Added

- Component-level theme token overrides (`tokenDefinitions` on a descriptor).

## [0.1.1] — 2026-04-21

### Added

- `granularChunkFileNames()` in the `./vite` entry — routes a provider's SFC
  chunks into `components/<Name>/chunks/`, without which the component's own
  classes never reach the final CSS.

## [0.1.0] — 2026-04-20

Initial release: the `GranularProvider` contract (`GRANULAR_CONTRACT_VERSION`
`1`), the browser preset, the node layer with filesystem scanning and CSS
reading, and theme/token assembly.
