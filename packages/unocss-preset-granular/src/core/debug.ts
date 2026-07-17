/**
 * Минимальный `debug`-совместимый логгер, управляемый переменной окружения
 * `DEBUG` (как одноимённый npm-пакет). Namespaces пресета:
 *   - `granular:resolve` — что зарезолвил core (провайдеры/компоненты/темы);
 *   - `granular:scan`    — директории/globs авто-сканирования (node-слой).
 *
 * Включение: `DEBUG=granular:*` (или конкретный namespace / `*`).
 * Браузеро-безопасен: при отсутствии `process` логирование просто выключено.
 */

function debugPatterns(): string[] {
  const env = (typeof process !== 'undefined' && process.env && process.env.DEBUG) || ''
  return env ? env.split(/[\s,]+/).filter(Boolean) : []
}

function matches(pattern: string, namespace: string): boolean {
  if (pattern === '*')
    return true
  if (pattern.endsWith('*'))
    return namespace.startsWith(pattern.slice(0, -1))
  return pattern === namespace
}

export function isDebugEnabled(namespace: string): boolean {
  return debugPatterns().some(pattern => matches(pattern, namespace))
}

/** Создаёт логгер для namespace; пишет в `stderr` только если он включён в `DEBUG`. */
export function createDebug(namespace: string): (message: string) => void {
  return (message: string): void => {
    if (isDebugEnabled(namespace))
      console.error(`  ${namespace} ${message}`)
  }
}
