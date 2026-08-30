import { describe, expect, it } from 'vitest'
import { scanCssBlocks, scanCssDeclarations } from '../node-utils/cssDeclarations'

const names = (css: string): string[] => scanCssDeclarations(css).map(d => d.token)
function valueOf(css: string, token: string): string | undefined {
  return scanCssDeclarations(css).find(d => d.token === token)?.value
}

describe('scanCssDeclarations: значение дочитывается до конца', () => {
  it('`;` внутри строкового литерала не завершает объявление', () => {
    expect(valueOf(':root{--a:"; ";--b:1px}', 'a')).toBe('"; "')
    expect(names(':root{--a:"; ";--b:1px}')).toEqual(['a', 'b'])
  })

  it('`;` внутри незакавыченного url() не завершает объявление', () => {
    const css = ':root{--dot:url(data:image/svg+xml;base64,AA==);--x:1px}'
    expect(valueOf(css, 'dot')).toBe('url(data:image/svg+xml;base64,AA==)')
    expect(names(css)).toEqual(['dot', 'x'])
  })

  it('многострочное значение с запятыми и скобками читается целиком', () => {
    const css = ':root{\n  --s:\n    0 4px 8px rgba(15, 23, 42, 0.1),\n    0 8px 24px rgba(15, 23, 42, 0.14);\n}'
    expect(valueOf(css, 's')).toContain('0 8px 24px rgba(15, 23, 42, 0.14)')
  })

  it('последнее объявление блока без `;` — валидно', () => {
    expect(valueOf(':root{--a:1px;--b:tabular-nums}', 'b')).toBe('tabular-nums')
  })

  it('комментарий между именем и `:` не разрывает объявление', () => {
    expect(valueOf(':root{--gap /* тут */: 8px}', 'gap')).toBe('8px')
  })

  it('guaranteed-invalid (пустое значение) — тоже объявление', () => {
    expect(names(':root{--empty:;--a:1px}')).toEqual(['empty', 'a'])
    expect(valueOf(':root{--empty:;--a:1px}', 'empty')).toBe('')
  })

  it('вложенные скобки color-mix не сбивают разбор', () => {
    const css = ':root{--m:color-mix(in oklab, var(--a) 92%, var(--b));--n:2px}'
    expect(valueOf(css, 'm')).toBe('color-mix(in oklab, var(--a) 92%, var(--b))')
    expect(names(css)).toEqual(['m', 'n'])
  })
})

describe('scanCssDeclarations: что объявлением НЕ является', () => {
  it('имя токена внутри комментария', () => {
    expect(names(':root{/* --fake: 1px; */--real:2px}')).toEqual(['real'])
  })

  it('имя токена внутри строки', () => {
    expect(names(':root{content:"--fake: 1px";--real:2px}')).toEqual(['real'])
  })

  it('`var(--x)` в значении обычного свойства', () => {
    expect(names(':root{color:var(--fg);--real:2px}')).toEqual(['real'])
  })
})

describe('scanCssDeclarations: полнота обхода', () => {
  it('блоки внутри at-rules видны — на этом держится обрезка fallback-ов', () => {
    // `parseCssCustomPropertyBlocksSync` такие блоки ПРОПУСКАЕТ (reason:
    // 'at-rule'), и это верно для его вопроса. Здесь вопрос другой.
    const css = ':root{--a:color-mix(in oklab,red,blue)}@supports not (color:color-mix(in oklab,red,blue)){:root{--a:#fff}}'
    const decls = scanCssDeclarations(css)
    expect(decls.map(d => d.token)).toEqual(['a', 'a'])
    expect(decls[1].path).toEqual(['@supports not (color:color-mix(in oklab,red,blue))', ':root'])
  })

  it('вложенные блоки дают полный путь', () => {
    const css = '@media (min-width:1px){@supports (x:1){.a{--t:1px}}}'
    expect(scanCssDeclarations(css)[0].path).toEqual(['@media (min-width:1px)', '@supports (x:1)', '.a'])
  })

  it('составной селектор нормализуется, но сохраняется', () => {
    const css = '[data-theme=\'dark\'],\n.dark {\n  --a: 1px;\n}'
    expect(scanCssDeclarations(css)[0].selector).toBe('[data-theme=\'dark\'], .dark')
  })

  it('cRLF не ломает смещения', () => {
    const css = ':root {\r\n  --a: 1px;\r\n  --b: 2px;\r\n}'
    const decls = scanCssDeclarations(css)
    expect(decls.map(d => d.token)).toEqual(['a', 'b'])
    expect(css.slice(decls[0].start, decls[0].end)).toBe('--a: 1px;')
  })
})

describe('scanCssBlocks: hasOtherContent', () => {
  it('блок только с токенами — пустой по смыслу', () => {
    expect(scanCssBlocks(':root{--a:1px}').blocks[0].hasOtherContent).toBe(false)
  })

  it('блок со смесью токенов и обычных объявлений — нет', () => {
    expect(scanCssBlocks(':root{--a:1px;color:red}').blocks[0].hasOtherContent).toBe(true)
  })

  it('at-rule, внутри которого только блок токенов, своим содержимым не считается', () => {
    // Прелюдия вложенного блока физически лежит в теле родителя. Пометка «есть
    // другое содержимое» по ходу обхода срабатывала бы на ней, и `@supports`
    // никогда не считался бы опустевшим.
    const at = scanCssBlocks('@supports (x:1){:root{--a:1px}}').blocks[0]
    expect(at.hasOtherContent).toBe(false)
    expect(at.children[0].hasOtherContent).toBe(false)
  })

  it('комментарии содержимым не считаются', () => {
    expect(scanCssBlocks(':root{/* заголовок */--a:1px}').blocks[0].hasOtherContent).toBe(false)
  })
})
