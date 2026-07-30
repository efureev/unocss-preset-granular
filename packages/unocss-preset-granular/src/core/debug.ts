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
  // `node/prefer-global/process` предлагает импорт из `node:process`, но
  // `src/core/` едет в браузерный бандл — любой `node:`-импорт здесь ломает
  // экспорт `.`. Поэтому именно глобальный `process` под guard'ом.
  // eslint-disable-next-line node/prefer-global/process
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

/**
 * Создаёт логгер для namespace; пишет в `stderr` только если он включён в `DEBUG`.
 *
 * `DEBUG` разбирается ОДИН раз — при создании логгера, а не на каждый вызов.
 * Выключенный логгер после этого стоит ровно ничего: возвращается no-op, и
 * `debugScan(...)`/`debugResolve(...)` в горячих путях не делают ни разбора
 * строки, ни аллокаций.
 *
 * Цена: смена `process.env.DEBUG` в рантайме уже созданными логгерами не
 * подхватывается. Для переменной окружения, которую выставляют перед запуском
 * процесса, это ожидаемо; если нужно проверить состояние на лету — есть
 * {@link isDebugEnabled}, он читает `DEBUG` каждый раз.
 */
export function createDebug(namespace: string): (message: string) => void {
  if (!isDebugEnabled(namespace))
    return () => {}

  return (message: string): void => {
    console.error(`  ${namespace} ${message}`)
  }
}
