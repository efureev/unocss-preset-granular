import type { GranularProvider } from '../contract'
import { describe, expect, it } from 'vitest'
import { defineGranularProvider } from '../contract'
import {
  CircularProviderDependencyError,
  DuplicateProviderIdError,
  UnresolvedProviderDependencyError,
} from '../core/errors'
import { expandProviders } from '../core/expandProviders'

function makeProvider(
  id: string,
  dependencies: readonly (GranularProvider | string)[] = [],
): GranularProvider {
  return defineGranularProvider({
    id,
    contractVersion: 1,
    packageBaseUrl: `file:///${id}/`,
    components: [],
    dependencies,
  })
}

describe('expandProviders', () => {
  it('возвращает roots без изменений, если нет dependencies', () => {
    const a = makeProvider('a')
    const b = makeProvider('b')
    const result = expandProviders([a, b])
    expect(result.map(p => p.id)).toEqual(['a', 'b'])
  })

  it('разворачивает простую цепочку A -> B (B раньше A)', () => {
    const b = makeProvider('b')
    const a = makeProvider('a', [b])
    const result = expandProviders([a])
    expect(result.map(p => p.id)).toEqual(['b', 'a'])
  })

  it('дедуплицирует diamond: A -> B, A -> C, C -> B', () => {
    const b = makeProvider('b')
    const c = makeProvider('c', [b])
    const a = makeProvider('a', [b, c])
    const result = expandProviders([a])
    expect(result.map(p => p.id)).toEqual(['b', 'c', 'a'])
  })

  it('бросает CircularProviderDependencyError на цикле A -> B -> A', () => {
    // обходим readonly через мутацию после создания
    const a: any = makeProvider('a')
    const b: any = makeProvider('b', [a])
    a.dependencies = [b]
    expect(() => expandProviders([a])).toThrow(CircularProviderDependencyError)
    expect(() => expandProviders([a])).toThrow(/a -> b -> a/)
  })

  it('бросает DuplicateProviderIdError при двух разных инстансах с одинаковым id', () => {
    const a1 = makeProvider('a')
    const a2 = makeProvider('a') // другой инстанс, тот же id
    expect(() => expandProviders([a1, a2])).toThrow(DuplicateProviderIdError)
  })

  it('не падает, если diamond использует тот же инстанс B', () => {
    const b = makeProvider('b')
    const c = makeProvider('c', [b])
    const a = makeProvider('a', [b, c]) // b встречается дважды, но один и тот же объект
    const result = expandProviders([a])
    expect(result.map(p => p.id)).toEqual(['b', 'c', 'a'])
  })

  it('строковая dependency резолвится, если нужный id уже есть в roots', () => {
    const b = makeProvider('b')
    const a = makeProvider('a', ['b'])
    const result = expandProviders([a, b])
    // порядок — визит в порядке roots: a пришёл первым, b подтянулся строкой,
    // но строки резолвятся soft — в итоговом order остаются только объектные визиты.
    expect(result.map(p => p.id).sort()).toEqual(['a', 'b'])
  })

  it('бросает UnresolvedProviderDependencyError, если строковый id не найден', () => {
    const a = makeProvider('a', ['b'])
    expect(() => expandProviders([a])).toThrow(UnresolvedProviderDependencyError)
    expect(() => expandProviders([a])).toThrow(/'b'/)
  })

  it('топосортирует несколько корней: roots=[a, c], a->b, c->b', () => {
    const b = makeProvider('b')
    const a = makeProvider('a', [b])
    const c = makeProvider('c', [b])
    const result = expandProviders([a, c])
    expect(result.map(p => p.id)).toEqual(['b', 'a', 'c'])
  })
})
