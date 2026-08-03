import {defineGranularComponent} from '@feugene/unocss-preset-granular/contract'

/**
 * Конфиг компонента — один на оба entry, browser и node.
 *
 * Токены темы объявлены ССЫЛКАМИ на CSS: `tokenDefinitionsRef` — это данные,
 * файлы по ним читает node-слой пресета при загрузке конфига приложения.
 * Поэтому здесь нет ни импорта из `/node`, ни парного `config.node.ts`:
 * браузерный экспорт `./granular-provider` остаётся свободным от `node:fs`.
 */
export const xTokenizedConfig = defineGranularComponent(import.meta.url, {
    name: 'XTokenized',
    // Компонент намеренно держит ОБЕ формы ссылки — они не равнозначны, и обе
    // должны проверяться сборкой приложений (`verify:apps`).
    tokenDefinitionsRef: {
        // Форма 1 — литерал `new URL(..., import.meta.url)`. Бандлер узнаёт
        // именно его и инлайнит содержимое файла как `data:text/css;base64`
        // прямо в чанк. Ничего доносить в `dist` не нужно, но CSS уезжает в
        // бандл — и, поскольку конфиг общий для browser- и node-entry, платит
        // за это и клиентский бандл потребителя.
        light: new URL('./themes/light.css', import.meta.url).href,
        // Форма 2 — строка. В бандл не попадает ничего, файл кладёт в `dist`
        // по `assetName` плагин `granularCssAssetsPlugin` (см. vite.config.ts).
        // Выбор в пользу неё — про размер клиентского бандла.
        //
        // В файле один блок с составным селектором — забираем его и
        // переозначиваем под тот селектор, под которым эмитим.
        dark: {url: './themes/dark.css', as: '.dark, [data-theme="dark"]'},
    },
})
