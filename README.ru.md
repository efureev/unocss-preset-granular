# `@feugene/unocss-preset-granular`

Универсальный UnoCSS‑пресет, который агрегирует стили, темы и `safelist` из
произвольного числа **granular‑провайдеров** (пакетов компонентов). Сам
пресет UI‑агностичен — работает поверх публичного контракта
`GranularProvider`.

- **ESM only**, Node ≥ 22, TypeScript strict.
- Три entry: `.` (browser), `./node` (build‑time FS),
  `./contract` (типы + хелперы для авторов провайдеров).
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
  правок в компонентах.
- **Микрофронты** — каждый MFE выбирает свой набор компонентов из общих
  провайдеров; координация `safelist` между командами не нужна.
- **Постепенная миграция на UnoCSS** — подключаете granular‑пакеты по
  одному, не ломая существующие стили.

## Быстрый старт

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
  content: granularContent(granularOptions), // обязательно — см. доку
})
```

## Документация

Полная документация — в [`./docs`](./docs), на **русском** и **английском**.

🇷🇺 **Русский** — [`./docs/ru/README.md`](./docs/ru/README.md)

- [Быстрый старт](./docs/ru/getting-started.md)
- [Использование в приложениях](./docs/ru/usage-in-apps.md)
- [Написание пакетов‑провайдеров](./docs/ru/authoring-providers.md)
- [Сканирование компонентов (`content.filesystem`)](./docs/ru/component-scanning.md)
- [Темы и токены](./docs/ru/themes-and-tokens.md)
- [Архитектура](./docs/ru/architecture.md)
- [Рецепты и отладка](./docs/ru/troubleshooting.md)

🇬🇧 **English** — [`./docs/en/README.md`](./docs/en/README.md)

- [Getting started](./docs/en/getting-started.md)
- [Usage in applications](./docs/en/usage-in-apps.md)
- [Authoring provider packages](./docs/en/authoring-providers.md)
- [Component scanning](./docs/en/component-scanning.md)
- [Themes and tokens](./docs/en/themes-and-tokens.md)
- [Architecture](./docs/en/architecture.md)
- [Troubleshooting & recipes](./docs/en/troubleshooting.md)

## Пакеты в этой монорепе

- [`packages/unocss-preset-granular`](./packages/unocss-preset-granular) — сам пресет.
- [`packages/simple-package`](./packages/simple-package) и
  [`packages/extra-simple-package`](./packages/extra-simple-package) — два
  эталонных granular‑провайдера (extra декларирует cross‑provider
  `dependencies` на simple).
- [`apps/app-3`](./apps/app-3) — демо‑приложение, потребляющее обоих
  провайдеров через пресет.

## Лицензия

См. [LICENSE](./LICENSE).
