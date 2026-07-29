import {defineGranularComponent} from '@feugene/unocss-preset-granular/contract'

/**
 * БРАУЗЕРНЫЙ конфиг компонента. Только литералы и URL — никакого FS.
 *
 * Импорт `@feugene/unocss-preset-granular/node` отсюда запрещён: этот модуль
 * попадает в `granular-provider/index.ts`, то есть в браузерный экспорт
 * `./granular-provider`, и утянул бы `node:fs` в клиентский бандл. Сборка при
 * этом НЕ падает — ломается только рантайм у потребителя.
 *
 * Токены темы, которые нужно вычитать из CSS, объявлены в соседнем
 * `config.node.ts` и подключаются через `granular-provider/node.ts`.
 */
export const xTokenizedConfig = defineGranularComponent(import.meta.url, {
    name: 'XTokenized',
})
