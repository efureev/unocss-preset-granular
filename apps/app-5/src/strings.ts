import manifest from 'virtual:granular-i18n'
import {en, ptBR, ru} from '@feugene/simple-package/i18n'

/**
 * Строки пакетов, собранные из манифеста сборки.
 *
 * Импорты здесь написаны РУКАМИ — ровно те, что назвал манифест. Пресет отдаёт
 * адреса и имена экспортов, а не готовый код: сгенерировать `import { en }`
 * может только тот, кто знает, каким бандлером это собирается. Приложение —
 * знает.
 *
 * Сверка ниже — не украшение: она ловит расхождение между тем, что решила
 * сборка, и тем, что реально импортировано. Без неё забытый импорт нового
 * пакета выглядел бы как «у него просто нет строк».
 */
const imported: Record<string, unknown> = {
    '@feugene/simple-package:en': en,
    '@feugene/simple-package:ru': ru,
    '@feugene/simple-package:ptBR': ptBR,
}

const missing = manifest.entries.flatMap(entry =>
    entry.bindings
        .filter(binding => imported[`${entry.providerId}:${binding.exportName}`] === undefined)
        .map(binding => `${entry.providerId} → ${binding.exportName} (${binding.locale})`),
)

if (missing.length > 0)
    throw new Error(`manifest promises loaders nobody imported: ${missing.join(', ')}`)

/**
 * То, что ушло бы в `createFintI18n({ loaders })`.
 *
 * Порядок — из манифеста: доноры раньше зависимых, а мердж лоадеров в
 * `fint-i18n` идёт слева направо, так что порядок это семантика, а не вкус.
 */
export const loaders = manifest.entries.flatMap(entry =>
    entry.bindings.map(binding => imported[`${entry.providerId}:${binding.exportName}`]),
)

/** Языки, доступные приложению, — вход для `negotiateLocale`. */
export const availableLocales = manifest.locales

/** Запрошенные языки, которых не отдаёт ни один пакет. */
export const unservedLocales = manifest.unserved
