import { describe, expect, it } from 'vitest'

import {
  classifyAsset,
  classifyClassEvidence,
  collectBareNames,
  collectVarUses,
  extractCssClasses,
  htmlClassTokens,
  reachableTokens,
  scanCssDeclarations,
  stripRanges,
  unescapeCss,
  whitespaceTokens,
} from '../cssBudget.mjs'

describe('classifyAsset', () => {
  it('опознаёт роли по имени файла', () => {
    expect(classifyAsset('vue-abc.js')).toBe('vue')
    expect(classifyAsset('granular-abc.css')).toBe('granular')
    expect(classifyAsset('hpkg-abc.css')).toBe('pkg')
    expect(classifyAsset('index-abc.js')).toBe('entry')
  })

  it('незнакомое имя не относит ни к какой роли', () => {
    // Отчёт на этом падает намеренно: корзина «прочее» превращает
    // разъехавшуюся раскладку стенда в молчаливую потерю килобайтов.
    expect(classifyAsset('mystery-abc.js')).toBeUndefined()
  })
})

describe('scanCssDeclarations', () => {
  const names = css => scanCssDeclarations(css).map(d => d.token)
  const valueOf = (css, token) => scanCssDeclarations(css).find(d => d.token === token)?.value

  it('`;` внутри строки не завершает объявление', () => {
    expect(valueOf(':root{--a:"; ";--b:1px}', 'a')).toBe('"; "')
    expect(names(':root{--a:"; ";--b:1px}')).toEqual(['a', 'b'])
  })

  it('`;` внутри url() не завершает объявление', () => {
    expect(valueOf(':root{--d:url(data:x;base64,AA==);--b:1px}', 'd')).toBe('url(data:x;base64,AA==)')
  })

  it('видит объявления внутри at-rules', () => {
    // Иначе фолбэки производных ролей не считаются вовсе, и «объявлено»
    // расходится с тем, что реально лежит в файле.
    expect(names(':root{--a:1}@supports not (x){:root{--a:2}}')).toEqual(['a', 'a'])
  })

  it('последнее объявление без `;`', () => {
    expect(valueOf(':root{--a:1px;--b:tabular-nums}', 'b')).toBe('tabular-nums')
  })
})

describe('extractCssClasses', () => {
  it('разбирает экранирование arbitrary-утилит', () => {
    // Наивный /\.[\w-]+/ обрезал бы это до `bg-`, и метрика классов
    // превратилась бы в счётчик префиксов.
    expect([...extractCssClasses('.bg-\\[var\\(--x\\)\\]{color:red}')]).toEqual(['bg-[var(--x)]'])
  })

  it('НЕэкранированное `:` обрывает имя, экранированное — нет', () => {
    expect([...extractCssClasses('.hover\\:p-4:hover{padding:1rem}')]).toEqual(['hover:p-4'])
  })

  it('число после точки классом не считается', () => {
    expect([...extractCssClasses('.a{margin:.5rem}')]).toEqual(['a'])
  })
})

describe('reachableTokens', () => {
  it('токен, достижимый только из значения мёртвого токена, мёртв', () => {
    // Ровно это отличает измеритель от `grep var(`: у фундамента с
    // производными ролями плоский подсчёт систематически завышает живую долю.
    const values = new Map([
      ['soft', ['color-mix(in oklab, var(--danger) 18%, var(--bg))']],
      ['danger', ['#f00']],
    ])
    expect(reachableTokens(new Set(['bg']), values).has('danger')).toBe(false)
  })

  it('от живого корня замыкание проходит по ссылкам', () => {
    const values = new Map([['soft', ['var(--danger)']], ['danger', ['var(--raw)']]])
    const reached = reachableTokens(new Set(['soft']), values)
    expect([...reached].sort()).toEqual(['danger', 'raw', 'soft'])
  })

  it('взаимная ссылка не зацикливает', () => {
    const values = new Map([['a', ['var(--b)']], ['b', ['var(--a)']]])
    expect(reachableTokens(new Set(['a']), values).size).toBe(2)
  })
})

describe('collectVarUses / collectBareNames / stripRanges', () => {
  it('fallback фиксируется как факт', () => {
    expect(collectVarUses('a{x:var(--t, 8px)}').get('t')).toBe(true)
    expect(collectVarUses('a{x:var(--t)}').get('t')).toBe(false)
  })

  it('голое имя — канал JS', () => {
    expect(collectBareNames('el.style.setProperty(--z-modal, 1)').has('z-modal')).toBe(true)
  })

  it('stripRanges вырезает указанные диапазоны', () => {
    expect(stripRanges('abcdef', [{ start: 1, end: 3 }])).toBe('adef')
  })

  it('unescapeCss схлопывает экранирование', () => {
    expect(unescapeCss('\\[var\\(--x\\)\\]')).toBe('[var(--x)]')
  })
})

describe('classifyClassEvidence', () => {
  const ctx = {
    htmlClasses: new Set(['in-html']),
    jsTokens: whitespaceTokens('in-js other'),
    jsText: 'const c = "p-" + n; "in-js other"',
    structuralClasses: new Set(['xh-card']),
  }

  it('целый токен в разметке — доказательство', () => {
    expect(classifyClassEvidence('in-html', ctx).proven).toBe(true)
  })

  it('целый токен в литерале JS — доказательство', () => {
    expect(classifyClassEvidence('in-js', ctx).proven).toBe(true)
  })

  it('литерал-префикс доказательством НЕ является', () => {
    // Иначе двухсимвольный `"p-"` обелил бы вообще всё.
    const row = classifyClassEvidence('p-4', ctx)
    expect(row.evidence).toEqual(['js-fragment'])
    expect(row.proven).toBe(false)
  })

  it('структурный класс идёт отдельной корзиной, а не в доказанные', () => {
    const row = classifyClassEvidence('xh-card', ctx)
    expect(row.evidence).toEqual(['component-css'])
    expect(row.proven).toBe(false)
  })

  it('класс без единой улики остаётся ни с чем', () => {
    expect(classifyClassEvidence('orphan', ctx).evidence).toEqual([])
  })
})

describe('htmlClassTokens', () => {
  it('вытаскивает классы из атрибутов разметки', () => {
    expect([...htmlClassTokens('<div class="a b"><i class=\'c\'>')].sort()).toEqual(['a', 'b', 'c'])
  })
})
