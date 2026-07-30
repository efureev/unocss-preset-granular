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
    tokenDefinitionsRef: {
        // Литеральный `new URL(..., import.meta.url)` — не украшательство:
        // именно на этот литерал реагирует бандлер и кладёт CSS темы в свой
        // выход. Строковая форма ('./themes/light.css') подошла бы, только
        // если файл и так эмитится по контрактному пути
        // `components/<Name>/...`, как это делает styles.css компонента.
        light: new URL('./themes/light.css', import.meta.url).href,
        // В файле один блок с составным селектором — забираем его и
        // переозначиваем под тот селектор, под которым эмитим.
        dark: {url: new URL('./themes/dark.css', import.meta.url).href, as: '.dark, [data-theme="dark"]'},
    },
})
