import { describe, expect, it } from 'vitest'
import { pruneCssDeclarations } from '../node-utils/pruneCssDeclarations'

const keepOnly = (...tokens: string[]) => (token: string): boolean => tokens.includes(token)
const ALL = (): boolean => true
const NONE = (): boolean => false

describe('pruneCssDeclarations: гарантия «ничего не удалено»', () => {
  it('возвращает ТУ ЖЕ строку по ссылке, а не равную копию', () => {
    // На этой гарантии держится обещание «выключенная обрезка не меняет
    // эмиссию ни на байт»: сравнение по ссылке ловит даже переформатирование.
    const css = ':root {\n  --a: 1px;\n}\n'
    const result = pruneCssDeclarations(css, ALL)
    expect(result.css).toBe(css)
    expect(result.removed).toEqual([])
    expect(result.emptiedBlocks).toEqual([])
  })

  it('файл без единого custom property не трогается', () => {
    const css = 'body { color: red }\n'
    expect(pruneCssDeclarations(css, NONE).css).toBe(css)
  })
})

describe('pruneCssDeclarations: удаление объявлений', () => {
  it('вырезает объявление вместе со строкой, не оставляя дыры', () => {
    const css = ':root {\n  --a: 1px;\n  --b: 2px;\n  --c: 3px;\n}\n'
    expect(pruneCssDeclarations(css, keepOnly('a', 'c')).css)
      .toBe(':root {\n  --a: 1px;\n  --c: 3px;\n}\n')
  })

  it('на минифицированном CSS перевод строки не съедается', () => {
    const css = ':root{--a:1px;--b:2px;--c:3px}'
    expect(pruneCssDeclarations(css, keepOnly('a', 'c')).css).toBe(':root{--a:1px;--c:3px}')
  })

  it('значение с `;` внутри url() удаляется целиком, а не до первой `;`', () => {
    const css = ':root{--dot:url(data:image/svg+xml;base64,AA==);--keep:1px}'
    expect(pruneCssDeclarations(css, keepOnly('keep')).css).toBe(':root{--keep:1px}')
  })

  it('последнее объявление без `;` удаляется корректно', () => {
    const css = ':root{--a:1px;--b:tabular-nums}'
    expect(pruneCssDeclarations(css, keepOnly('a')).css).toBe(':root{--a:1px;}')
  })

  it('идемпотентна', () => {
    const css = ':root {\n  --a: 1px;\n  --b: 2px;\n}\n'
    const once = pruneCssDeclarations(css, keepOnly('a')).css
    expect(pruneCssDeclarations(once, keepOnly('a')).css).toBe(once)
  })
})

describe('pruneCssDeclarations: что сохраняется', () => {
  it('обычные правила и их порядок', () => {
    const css = 'body { margin: 0 }\n:root {\n  --a: 1px;\n}\nhr { border: 0 }\n'
    expect(pruneCssDeclarations(css, NONE).css).toBe('body { margin: 0 }\nhr { border: 0 }\n')
  })

  it('комментарии — даже осиротевшие', () => {
    // Заголовок группы относится к НАБОРУ объявлений, а не к следующему за
    // ним. Привязать его к соседу значит удалять заголовки, которые ещё
    // актуальны; цена решения — заголовок без содержимого.
    const css = ':root {\n  /* Surface roles */\n  --a: 1px;\n  --b: 2px;\n}\n'
    expect(pruneCssDeclarations(css, keepOnly('b')).css)
      .toBe(':root {\n  /* Surface roles */\n  --b: 2px;\n}\n')
  })

  it('блок со смесью custom и обычных объявлений не удаляется', () => {
    const css = '.x { --a: 1px; color: red }\n'
    expect(pruneCssDeclarations(css, NONE).css).toBe('.x { color: red }\n')
  })
})

describe('pruneCssDeclarations: опустевшие блоки', () => {
  it('пустой блок удаляется целиком, вместе с прелюдией', () => {
    const css = ':root {\n  --a: 1px;\n}\nbody { margin: 0 }\n'
    const result = pruneCssDeclarations(css, NONE)
    expect(result.css).toBe('body { margin: 0 }\n')
    expect(result.emptiedBlocks).toEqual([':root'])
  })

  it('опустевший at-rule уходит вместе со своей скорлупой', () => {
    const css = '@supports not (color: color-mix(in oklab, red, blue)) {\n  :root {\n    --a: #fff;\n  }\n}\n'
    const result = pruneCssDeclarations(css, NONE)
    expect(result.css).toBe('')
    expect(result.emptiedBlocks).toEqual(['@supports not (color: color-mix(in oklab, red, blue))'])
  })

  it('at-rule с уцелевшим токеном остаётся', () => {
    const css = '@supports (x: 1) {\n  :root {\n    --a: 1px;\n    --b: 2px;\n  }\n}\n'
    expect(pruneCssDeclarations(css, keepOnly('b')).css)
      .toBe('@supports (x: 1) {\n  :root {\n    --b: 2px;\n  }\n}\n')
  })
})

describe('pruneCssDeclarations: главный кейс — fallback внутри @supports', () => {
  it('удалённый токен уходит из ОБОИХ мест, сохранённый — остаётся в обоих', () => {
    // Ради этого обрезка сделана текстовой. Плоский разбор блоков
    // (`parseCssCustomPropertyBlocksSync`) блок внутри at-rule не видит, и
    // пересборка из него оставила бы в файле fallback уже удалённого токена —
    // объявление, которое ни на что не ссылается и никем не потребляется.
    const css = [
      ':root {',
      '  --keep: color-mix(in oklab, red, blue);',
      '  --drop: color-mix(in oklab, red, green);',
      '}',
      '@supports not (color: color-mix(in oklab, red, blue)) {',
      '  :root {',
      '    --keep: #7f007f;',
      '    --drop: #7f7f00;',
      '  }',
      '}',
      '',
    ].join('\n')

    const result = pruneCssDeclarations(css, keepOnly('keep'))

    expect(result.removed).toEqual(['drop'])
    expect(result.css).not.toContain('--drop')
    // Оба объявления сохранённого токена на месте.
    expect(result.css.match(/--keep/g)).toHaveLength(2)
    expect(result.css).toContain('@supports not')
  })
})
