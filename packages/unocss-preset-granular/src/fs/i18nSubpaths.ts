import type { GranularProvider } from '../contract'

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Подпуть строк объявлен провайдером, но пакет его не экспортирует. */
export interface DoctorI18nSubpath {
  providerId: string
  /** Поле контракта, из которого пришёл спецификатор. */
  field: 'entry' | 'allEntry'
  /** Спецификатор целиком: `@pkg/name/i18n`. */
  specifier: string
  /** Он же ключом `exports`: `./i18n`. */
  subpath: string
  /** `package.json`, в котором смотрели. */
  packageJson: string
}

/**
 * Проверяет, что подпути строк действительно объявлены в `exports` пакета.
 *
 * SPEC требует от автора пакета отдельные записи для `./i18n` и `./i18n/all`,
 * но до сих пор это требование не проверялось ничем: пресет адреса только
 * публикует, а падает на них ЧУЖАЯ сборка — сообщением `Failed to resolve
 * import` в приложении, автор которого этих адресов не писал.
 *
 * Проверка намеренно осторожна: всё, в чём нельзя быть уверенным, пропускается
 * молча. Ложное срабатывание здесь дороже пропуска — диагностика уровня `warn`
 * роняет CI через `--strict`.
 *
 * Пропускается:
 *   - не-`file:` `packageBaseUrl` (пакет может резолвиться как угодно);
 *   - `package.json` не найден или его `name` не совпал с `id` провайдера;
 *   - `exports` отсутствует или не объект — старая раскладка, судить не о чем;
 *   - в `exports` есть паттерны (`./*`) — подпуть мог попасть под любой из них;
 *   - спецификатор указывает не в свой пакет (провайдер вправе отдать чужой).
 */
export function inspectI18nSubpaths(
  providers: readonly GranularProvider[],
): DoctorI18nSubpath[] {
  const found: DoctorI18nSubpath[] = []

  for (const provider of providers) {
    const i18n = provider.i18n
    if (!i18n)
      continue

    const manifest = readOwnPackageJson(provider)
    if (!manifest)
      continue

    const { path, exports } = manifest
    if (exports === undefined)
      continue

    const keys = Object.keys(exports)
    // Паттерны покрывают неизвестно что — судить о конкретном подпути нельзя.
    if (keys.some(key => key.includes('*')))
      continue

    const entry = i18n.entry ?? `${provider.id}/i18n`
    const candidates: readonly (readonly ['entry' | 'allEntry', string])[] = [
      ['entry', entry],
      ['allEntry', i18n.allEntry ?? `${entry}/all`],
    ]

    for (const [field, specifier] of candidates) {
      const subpath = toOwnSubpath(provider.id, specifier)
      if (subpath === undefined || keys.includes(subpath))
        continue

      found.push({ providerId: provider.id, field, specifier, subpath, packageJson: path })
    }
  }

  return found
}

/** `@pkg/name` + `@pkg/name/i18n` → `./i18n`; чужой спецификатор → `undefined`. */
function toOwnSubpath(providerId: string, specifier: string): string | undefined {
  if (specifier === providerId)
    return '.'
  return specifier.startsWith(`${providerId}/`)
    ? `.${specifier.slice(providerId.length)}`
    : undefined
}

interface OwnPackageJson {
  path: string
  exports?: Record<string, unknown>
}

/**
 * `package.json` САМОГО пакета — от `packageBaseUrl` вверх до совпадения по
 * `name`.
 *
 * Совпадение обязательно: `packageBaseUrl` указывает на `dist/`, и первый
 * найденный вверх `package.json` в монорепо вполне может оказаться корневым.
 */
function readOwnPackageJson(provider: GranularProvider): OwnPackageJson | undefined {
  if (!provider.packageBaseUrl.startsWith('file:'))
    return undefined

  let dir: string
  try {
    dir = fileURLToPath(provider.packageBaseUrl)
  }
  catch {
    return undefined
  }

  for (let depth = 0; depth < 8; depth++) {
    const path = join(dir, 'package.json')
    if (existsSync(path)) {
      const parsed = parsePackageJson(path)
      if (parsed?.name === provider.id) {
        const exports = parsed.exports
        return {
          path,
          ...(typeof exports === 'object' && exports !== null && !Array.isArray(exports)
            ? { exports: exports as Record<string, unknown> }
            : {}),
        }
      }
    }

    const parent = dirname(dir)
    if (parent === dir)
      return undefined
    dir = parent
  }

  return undefined
}

function parsePackageJson(path: string): { name?: string, exports?: unknown } | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as { name?: string, exports?: unknown }
  }
  catch {
    // Битый или нечитаемый `package.json` — не забота этой проверки.
    return undefined
  }
}
