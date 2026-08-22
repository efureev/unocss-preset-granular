/** Причина, по которой генерация реестров не может продолжаться. */
export type GranularCodegenReason
  /** Экспорт конфига компонента назван не так, как ждёт реестр. */
  = | 'config-export-name-mismatch'
  /** В файле нет открывающего маркера блока. */
    | 'missing-open-marker'
  /** В файле нет закрывающего маркера блока. */
    | 'missing-close-marker'
  /** В `package.json` нет поля `exports`. */
    | 'missing-package-exports'
  /** В `package.json#exports` нет ни одного subpath компонента. */
    | 'no-component-exports'
  /** Директории компонентов нет на диске. */
    | 'missing-components-dir'
  /** Имя подкомпонента занято другим компонентом или другой частью. */
    | 'subcomponent-name-clash'

/**
 * Генерация реестров провалилась. Отдельный класс, а не голый `Error`: этот
 * генератор зовут из скрипта пакета и из его тестов, и вызывающему нужно
 * отличать «реестры разошлись» от «сломалась сама оснастка» — по `reason`,
 * а не по тексту сообщения.
 */
export class GranularCodegenError extends Error {
  constructor(
    public readonly reason: GranularCodegenReason,
    message: string,
    /** Файл, на котором генерация остановилась (если применимо). */
    public readonly file?: string,
  ) {
    super(message)
    this.name = 'GranularCodegenError'
  }
}
