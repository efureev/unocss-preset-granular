/** Возвращает массив уникальных значений по identity. */
export function uniqueBy<T>(items: Iterable<T>, key: (item: T) => unknown): T[] {
  const seen = new Set<unknown>()
  const result: T[] = []
  for (const item of items) {
    const k = key(item)
    if (seen.has(k))
      continue
    seen.add(k)
    result.push(item)
  }
  return result
}

/** Уникализация по ссылке. */
export function uniqueRef<T>(items: Iterable<T>): T[] {
  return uniqueBy(items, item => item)
}
