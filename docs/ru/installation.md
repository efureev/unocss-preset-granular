# Установка и подключение `@feugene/unocss-preset-granular`

> Индекс документации: [`./README.md`](./README.md). См. также
> [Быстрый старт](./getting-started.md),
> [Использование в приложениях](./usage-in-apps.md),
> [Написание провайдеров](./authoring-providers.md).

Эта страница описывает **как правильно объявлять зависимость** на
`@feugene/unocss-preset-granular` в `package.json` разных типов потребителей
и, главное, — **в какую секцию** (`dependencies`, `devDependencies`,
`peerDependencies`) её класть.

Короткое правило:

- **Приложения** — ставят пресет в `devDependencies` (он нужен только на
  build‑time для `uno.config.ts`).
- **Пакеты‑провайдеры** (пакеты UI‑компонентов, которые экспортируют
  `GranularProvider`) — объявляют пресет в `peerDependencies` **и**
  зеркалят его в `devDependencies` (для локальной сборки/типов). В
  `dependencies` класть **нельзя** — иначе в финальном дереве
  приложения появится несколько копий пресета.

Ниже — подробности с готовыми сниппетами.

---

## 1. Подключение к конечному приложению

Конечное приложение — это то, что собирается Vite/другим бандлером и в
итоге даёт `virtual:uno.css`. Пресет используется только в
`uno.config.ts` на этапе сборки, в рантайм браузера он не попадает.

### 1.1. `package.json` приложения

```jsonc
{
  "name": "my-app",
  "type": "module",
  "devDependencies": {
    "@feugene/unocss-preset-granular": "^0.1.0",
    "unocss": "^66.0.0",
    "@unocss/preset-wind4": "^66.0.0",

    // Провайдеры, которые реально использует приложение:
    "@feugene/simple-package": "^0.1.0"
    // "@feugene/extra-simple-package": "^0.1.0",
  }
}
```

Почему `devDependencies`, а не `dependencies`:

- Пресет исполняется **на build‑time** (в `uno.config.ts` и
  `vite.config.ts`) и ни одной строкой кода не попадает в итоговый
  бандл приложения.
- Провайдеры также нужны пресету на build‑time (он читает их
  `granular-provider/node` entry). Если компоненты провайдера
  импортируются в исходниках приложения (`import { XTest1 } from
  '@feugene/simple-package/components/XTest1'`) — провайдер перейдёт в
  `dependencies`.

### 1.2. Требования окружения

- Node ≥ 22
- `"type": "module"` в `package.json` приложения (ESM only)
- `unocss` ≥ 66 (peer пресета, ставится приложением)

Все детали `uno.config.ts` и `vite.config.ts` — см. [Быстрый старт](./getting-started.md).

---

## 2. Подключение к пакету‑провайдеру

**Granular‑провайдер** — публикуемый npm‑пакет, который экспортирует
объект `GranularProvider` через
`@feugene/unocss-preset-granular/contract` (и опционально
`@feugene/unocss-preset-granular/node` для build‑time хелперов вроде
`tokenDefinitionsFromCssFile`).

Пресет в таком пакете используется:

- как **тип‑импорт** и фабрика (`defineGranularComponent`,
  `defineGranularProvider`) — на этапе сборки пакета и в dev (types);
- **ничего** из пресета в published‑бандл провайдера не попадает
  (фабрики — identity‑функции / типы).

### 2.1. `package.json` пакета‑провайдера

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

Что здесь важно:

- `peerDependencies` — **обязательно**. Декларирует, что версию пресета
  контролирует приложение; предотвращает задвоение пресета в дереве
  зависимостей (иначе контракт `GranularProvider` разойдётся между
  копиями и резолвинг сломается).
- `devDependencies` — дублируем пресет сюда, чтобы пакет мог собраться
  и протипизироваться локально (в монорепо через workspace‑ссылку,
  в одиночном пакете — из реестра).
- `dependencies` — **не используем** для пресета. Это приведёт к тому,
  что npm/yarn поставят его физически внутри `node_modules` пакета, и
  приложение получит другую копию пресета, отличную от своей.

### 2.2. Провайдер‑композит (зависит от другого провайдера)

Если ваш провайдер объявляет `dependencies` на компоненты **другого**
провайдера (например, `@feugene/simple-package` как донор), то донор
тоже объявляется как `peerDependency`:

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

Правило: **кто несёт реальный код компонентов — тот объявлен в
`peerDependencies` композитного провайдера**. Ставит его всегда
приложение.

### 2.3. Что экспортирует пакет‑провайдер

См. [Написание провайдеров](./authoring-providers.md) — раздел
`package.json exports`. Тут повторим только то, что важно для
установки: провайдер обязан публиковать entry‑точку
`./granular-provider` (браузерную) и по возможности
`./granular-provider/node` (build‑time). Приложение импортирует
именно `.../granular-provider/node` в `uno.config.ts`.

---

## 3. Матрица: куда писать зависимость

| Потребитель                         | `@feugene/unocss-preset-granular`    | `unocss`                            | Пакеты‑провайдеры                                      | `vue`                                   |
| ----------------------------------- | ------------------------------------ | ----------------------------------- | ------------------------------------------------------ | --------------------------------------- |
| Приложение                          | `devDependencies`                    | `devDependencies`                   | `devDependencies` (или `dependencies`, если импортируете компоненты в рантайм) | `dependencies`                          |
| Пакет‑провайдер (терминальный)      | `peerDependencies` + `devDependencies` | не нужен напрямую¹                  | —                                                      | `peerDependencies` + `devDependencies`  |
| Пакет‑провайдер (композит)          | `peerDependencies` + `devDependencies` | не нужен напрямую¹                  | `peerDependencies` + `devDependencies` (на донора)     | `peerDependencies` + `devDependencies`  |

¹ `unocss` — peer самого пресета. Если провайдер не импортирует
`unocss` напрямую (обычный случай), в его `package.json` его писать не
нужно — транзитивный peer обеспечит приложение.

---

## 4. Частые ошибки

- **Пресет в `dependencies` провайдера.** В монорепо это может
  «работать» за счёт hoist, но в чужом приложении приведёт к двум
  копиям пресета и непредсказуемому резолвингу `GranularProvider`.
  Исправление: перенести в `peerDependencies` (+ зеркало в
  `devDependencies`).
- **Провайдеры в `dependencies` пресета.** Пресет принципиально ничего
  не знает о конкретных UI‑пакетах. Провайдеры ставит только
  приложение. Пресет зависит только от `unocss` (peer).
- **Забытый `devDependency` на пресет в провайдере.** Тогда
  `peerDependencies` не хватит, чтобы локально собрать пакет (не
  будет типов и фабрик). Решение: явно дублировать в
  `devDependencies`.
- **Разные major‑версии пресета у приложения и провайдера.** Объявляйте
  диапазон в `peerDependencies` провайдера консервативно (`^X.Y.Z`
  под текущий мажор) и поднимайте его синхронно с рефакторингом
  контракта.

---

## 5. Проверить, что всё подключено корректно

В приложении после установки:

```bash
# Должна резолвиться ровно одна версия пресета:
yarn why @feugene/unocss-preset-granular

# Провайдер виден через build‑time entry:
node -e "import('@feugene/simple-package/granular-provider/node').then(m => console.log(Object.keys(m)))"
```

Если `yarn why` показывает несколько физически разных путей до
`@feugene/unocss-preset-granular` — какой‑то провайдер объявил пресет в
`dependencies` вместо `peerDependencies`; это нужно исправить в его
`package.json`.
