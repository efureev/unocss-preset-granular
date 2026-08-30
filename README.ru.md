# `@feugene/unocss-preset-granular`

Универсальный UnoCSS‑пресет, который агрегирует стили, темы и `safelist` из
произвольного числа **granular‑провайдеров** (пакетов компонентов). Сам
пресет UI‑агностичен — работает поверх публичного контракта
`GranularProvider`.

- **ESM only**, Node ≥ 22, TypeScript strict.
- Пять entry: `.` (browser), `./node` (build‑time FS),
  `./contract` (типы + хелперы для авторов провайдеров),
  `./vite` (хелперы сборки самого провайдера),
  `./runtime` (переключение тем в рантайме, без зависимостей).
- Транзитивные `dependencies` (в т.ч. cross‑provider) резолвятся через
  единый реестр компонентов.
- Статические классы из компонентов провайдера подхватывает UnoCSS через
  `content.filesystem` — без дублирования в `safelist`.

## Зачем этот пресет

- **В бандл попадает только реально нужный CSS.** В итоговую сборку
  уезжают стили только явно выбранных компонентов (+ их транзитивных
  `dependencies`).
- **Одна точка правды.** Статические классы живут в шаблонах компонентов;
  дублировать их в `safelist` приложения не нужно.
- **UI‑агностичность.** Работает с любой библиотекой компонентов,
  реализующей контракт `GranularProvider` (Vue, React, Svelte,
  web‑components, чистый CSS).
- **Cross‑package зависимости.** Компонент может зависеть от компонента
  из другого провайдера — граф резолвится пресетом.
- **Темы и токены из коробки.** Пресет агрегирует CSS‑переменные/файлы тем
  провайдеров по одному переключателю `themes.names`.
- **Собственные темы приложения.** Приложение объявляет свои темы через
  `themes.define` — наследуя провайдерскую через `extends` или отказавшись от
  `light`/`dark` целиком в пользу своей палитры.

## Что это даёт

- Ноль ручного `safelist` для статических классов компонентов.
- Меньше CSS: стили неиспользуемых компонентов не доезжают до пользователя.
- Обновление провайдера не требует правок в приложении — новые классы
  компонентов подхватываются автоматически при выборе компонента.
- Консистентная тема: одни и те же `light`/`dark`/кастомные темы во всех
  провайдерах.

## Юзкейсы

- **Дизайн‑система как npm‑пакет** — публикуете компоненты с их CSS и
  токенами; приложения вытягивают только то, что реально рендерят.
- **Монорепа с несколькими UI‑пакетами** — одно приложение потребляет
  несколько библиотек, зависимости между ними резолвятся автоматически.
- **White‑label / мульти‑тенант** — переключение тем под арендатора без
  правок в компонентах, в том числе
  [в рантайме](./docs/ru/themes-and-tokens.md#переключение-тем-в-рантайме).
- **Микрофронты** — каждый MFE выбирает свой набор компонентов из общих
  провайдеров; координация `safelist` между командами не нужна.
- **Постепенная миграция на UnoCSS** — подключаете granular‑пакеты по
  одному, не ломая существующие стили.

## Быстрый старт

```bash
yarn add -D @feugene/unocss-preset-granular unocss   # unocss ^66.7.5 — peer‑зависимость
```

```ts
// uno.config.ts
import { defineConfig, presetMini } from 'unocss'
import { granularContent, presetGranularNode, type PresetGranularNodeOptions } from '@feugene/unocss-preset-granular/node'
import simpleProvider from '@feugene/simple-package/granular-provider/node'

// В оба вызова ниже уходит ОДИН и тот же объект: граф компонентов, обход FS и
// эмиссия CSS мемоизированы по его идентичности, поэтому второй объектный
// литерал означает вторую полную резолюцию.
const granularOptions: PresetGranularNodeOptions = {
  providers: [simpleProvider],
  components: [{ provider: '@feugene/simple-package', names: ['XTest1', 'XTestStyled'] }],
  themes: { names: ['light', 'dark'] },
  // `layer` по умолчанию — 'granular' с объявленным порядком -50 (после
  // preflights, до утилит); `layer: null` — не назначать слой вовсе.
}

export default defineConfig({
  presets: [presetMini(), presetGranularNode(granularOptions)],
  content: granularContent(granularOptions), // обязательно — см. доку
})
```

## Документация

Полная документация — в [`./docs`](./docs), на **русском** и **английском**.

🇷🇺 **Русский** — [`./docs/ru/README.md`](./docs/ru/README.md)

- [Быстрый старт](./docs/ru/getting-started.md)
- [Установка и подключение](./docs/ru/installation.md)
- [Использование в приложениях](./docs/ru/usage-in-apps.md)
- [Написание пакетов‑провайдеров](./docs/ru/authoring-providers.md)
- [Правила создания компонента](./docs/ru/component-authoring.md)
- [Сканирование компонентов (`content.filesystem`)](./docs/ru/component-scanning.md)
- [Темы и токены](./docs/ru/themes-and-tokens.md)
- [Архитектура](./docs/ru/architecture.md)
- [Рецепты и отладка](./docs/ru/troubleshooting.md)
- [CLI `granular`](./docs/ru/cli.md)
- [Миграция `0.4.0` → `0.5.0`](./docs/ru/migration-0.5.md)
- [Замер веса CSS/JS](./docs/ru/measuring-weight.md)

🇬🇧 **English** — [`./docs/en/README.md`](./docs/en/README.md)

- [Getting started](./docs/en/getting-started.md)
- [Installation](./docs/en/installation.md)
- [Usage in applications](./docs/en/usage-in-apps.md)
- [Authoring provider packages](./docs/en/authoring-providers.md)
- [Component authoring rules](./docs/en/component-authoring.md)
- [Component scanning](./docs/en/component-scanning.md)
- [Themes and tokens](./docs/en/themes-and-tokens.md)
- [Architecture](./docs/en/architecture.md)
- [Troubleshooting & recipes](./docs/en/troubleshooting.md)
- [The `granular` CLI](./docs/en/cli.md)
- [Migrating `0.4.0` → `0.5.0`](./docs/en/migration-0.5.md)

## CLI — `granular`

Пакет ставит бинарь `granular` с четырьмя диагностическими командами. `doctor`
печатает резолвнутую конфигурацию: провайдеров, транзитивный граф компонентов,
имена тем (и откуда они взялись), конфликты токенов между слоями, итоговые
скан‑globs и директории компонентов, нарушающие layout‑контракт; `explain`
объясняет, почему компонент в сборке; `why-css` — какой компонент притащил
класс в CSS; `tokens` — какие токены тем компонент объявляет и потребляет и
откуда берётся каждое значение:

```bash
# granular.options.mjs — тот же объект опций, что уходит в пресет
npx granular doctor  ./granular.options.mjs --strict
npx granular explain ./granular.options.mjs '@feugene/simple-package:XTokenized'
npx granular why-css ./granular.options.mjs 'rounded-3xl'
npx granular tokens  ./granular.options.mjs XTokenized --deep
```

Код выхода `1` — найдены нарушения layout‑контракта (с `--strict` — и
предупреждения), поэтому команду можно ставить в CI; `--json` даёт каждой
команде структурный отчёт. Полный справочник: [CLI `granular`](./docs/ru/cli.md).

## Пакеты в этой монорепе

- [`packages/unocss-preset-granular`](./packages/unocss-preset-granular) — сам пресет.
- [`packages/simple-package`](./packages/simple-package) и
  [`packages/extra-simple-package`](./packages/extra-simple-package) — два
  эталонных granular‑провайдера (extra декларирует cross‑provider
  `dependencies` на simple).
- [`packages/heavy-package`](./packages/heavy-package) — провайдер‑фикстура с
  полноценным фундаментом дизайн‑системы (`tokens.css`, `base.css`,
  `light`/`dark`), на нём стоят стенды замера веса.
- [`apps/app-1..6`](./apps) — шесть демо‑приложений, по сценарию на каждое:
  минимальный автоскан (`app-1`), `safelist` + переопределение токенов темы без
  файлового скана (`app-2`), транзитивный донор и кросс‑пакетные зависимости
  компонентов (`app-3`), вложенные SFC плюс сторонний набор правил (`app-4`),
  переключение тем в рантайме (`app-5`), собственные темы приложения вместо
  провайдерских `light`/`dark` (`app-6`).
- [`apps/bench-zero`, `apps/bench-one`, `apps/bench-pruned`](./apps) — три
  стенда замера: нулевая отметка, цена одного компонента и эффект обрезки
  токенов. См. [Замер веса CSS/JS](./docs/ru/measuring-weight.md).

Только в них цепочка «сборка провайдера → пресет → UnoCSS → CSS» проходит
целиком, поэтому они же служат интеграционным тестом контракта:

```bash
yarn build:all && yarn verify:apps
```

`verify:apps` сверяет собранный CSS каждого приложения с
`apps/<app>/expected-css.mjs` — списком того, что должно и что НЕ должно
оказаться в выводе. Зелёная сборка сама по себе не доказывает ничего: она
остаётся зелёной и тогда, когда классы компонентов молча исчезли из CSS.

## Лицензия

MIT — см. [LICENSE](./LICENSE).
