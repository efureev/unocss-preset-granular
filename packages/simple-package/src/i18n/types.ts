/**
 * Форма коллекции лоадеров `fint-i18n`, объявленная СТРУКТУРНО.
 *
 * Пакет-фикстура не тянет i18n-рантайм в зависимости — ровно как сам пресет:
 * контракт `GranularI18nContribution` описывает адреса, а не формат словарей.
 * Реальный пакет напишет `import type { LocaleLoaderCollection } from
 * '@feugene/fint-i18n/core'`.
 *
 * Верхний ключ — ТЕГ локали (`pt-BR`), второй — имя блока.
 */
export type LocaleLoaderCollection = Readonly<Record<string, Readonly<Record<string, () => Promise<unknown>>>>>
