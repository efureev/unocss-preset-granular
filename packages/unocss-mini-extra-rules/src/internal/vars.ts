import type { CSSEntries, UnoGenerator, UtilObject } from '@unocss/core'

/**
 * Внутренний хелпер: имена кастомных свойств, которые правила пишут литералом
 * `--un-*`, не обязаны такими и остаться. `presetMini` с
 * `variablePrefix: 'ds-'` переименовывает их своим `postprocess`
 * (`VarPrefixPostprocessor`) — но только там, куда он дотягивается: в `entries`
 * утилиты. Всё, что правило или preflight собирает строкой само, он не видит,
 * и имена расходятся молча: CSS сгенерируется, а свойство соберётся из
 * неопределённых переменных.
 *
 * Поэтому такие имена прогоняются через тот же конвейер, а не переименовываются
 * вручную: пайплайн — единственный источник правды о префиксе, и опцию
 * `variablePrefix` правилу неоткуда прочитать.
 */

/**
 * Прогоняет `entries` через `config.postprocess` генератора и возвращает то,
 * что получилось.
 */
export function postprocessEntries(
  generator: UnoGenerator<any>,
  entries: CSSEntries,
  selector: string,
): CSSEntries {
  let util: UtilObject = {
    selector,
    entries,
    parent: undefined,
    layer: undefined,
    sort: undefined,
    noMerge: undefined,
  }

  for (const postprocess of generator.config.postprocess) {
    // Постпроцессор либо мутирует объект на месте (так делает
    // `VarPrefixPostprocessor`), либо возвращает новый. Разбиение на несколько
    // утилит для блока переменных смысла не имеет — берём первую.
    const processed = postprocess(util)
    if (Array.isArray(processed))
      util = processed.find(Boolean) ?? util
    else if (processed)
      util = processed
  }

  return util.entries
}

/**
 * Имена переменных в том виде, в каком их увидят утилиты. Значение — пустая
 * строка: важно только, что станет с ключом.
 */
export function resolveVarNames(generator: UnoGenerator<any>, names: string[]): string[] {
  return postprocessEntries(generator, names.map(name => [name, '']), '*')
    .map(([name]) => name)
}
