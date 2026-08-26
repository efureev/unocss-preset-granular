import {en, ptBR, ru} from '@feugene/simple-package/i18n'

/**
 * Строки пакета — **именованными** импортами, по одному на язык.
 *
 * Приложению нужны три языка из четырёх, что объявляет пакет. Агрегат
 * `@feugene/simple-package/i18n/all` привёл бы и четвёртый: `verify:apps`
 * проверяет, что словаря `es` в бандле нет, и это единственное место, где
 * отсечение языков доказано сборкой, а не документацией.
 *
 * `pt-BR` импортируется как `ptBR`: тег локали идентификатором быть не может,
 * и у каждого регионального языка эти две строки расходятся.
 */
export const loaders = [en, ru, ptBR]

/** Языки, доступные приложению, — вход для `negotiateLocale`. */
export const availableLocales = ['en', 'ru', 'pt-BR']

/**
 * Лоадеры вызываются, а не только импортируются.
 *
 * Без вызова динамический `import()` внутри них недостижим, и Rollup
 * выбрасывает словари целиком — вместе с проверкой, ради которой они здесь.
 * Настоящее приложение делает то же самое через `loadBlock` своего i18n-слоя.
 */
export const dictionaries = Promise.all(
    loaders.flatMap(collection =>
        Object.values(collection).flatMap(byBlock => Object.values(byBlock).map(load => load())),
    ),
)
