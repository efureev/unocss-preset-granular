import { createGenerator, presetMini } from 'unocss'
import { describe, expect, it, vi } from 'vitest'
import { defineGranularProvider } from '../contract'
import { getGranularNodeCss, presetGranularNode } from '../preset.node'

/** Провайдер с компонентом, чей CSS содержит `@apply`. */
const provider = defineGranularProvider({
  id: 'd',
  contractVersion: 1,
  packageBaseUrl: 'file:///d/',
  components: [
    {
      name: 'C',
      safelist: [],
      cssFiles: [`data:text/css,${encodeURIComponent('.x{ @apply p-4; }')}`],
    },
  ],
})

async function getNodePreflightCss(options: Parameters<typeof presetGranularNode>[0]): Promise<string> {
  const uno = await createGenerator({ presets: [presetMini()] })
  const preset = presetGranularNode(options)
  const preflight = preset.preflights![0]
  const css = await preflight.getCSS({ generator: uno, theme: (uno as any).config?.theme ?? {} } as never)
  return css ?? ''
}

describe('expandDirectives (G2)', () => {
  it('раскрывает @apply в component cssFiles при expandDirectives=true', async () => {
    const css = await getNodePreflightCss({
      providers: [provider],
      components: 'all',
      expandDirectives: true,
    })
    expect(css).toContain('padding')
    expect(css).not.toContain('@apply')
  })

  it('по умолчанию @apply остаётся нераскрытым', async () => {
    const css = await getNodePreflightCss({
      providers: [provider],
      components: 'all',
    })
    expect(css).toContain('@apply p-4')
    expect(css).not.toContain('padding')
  })

  it('getGranularNodeCss отдаёт сырой CSS (без раскрытия директив)', async () => {
    const raw = await getGranularNodeCss({
      providers: [provider],
      components: 'all',
      expandDirectives: true,
    })
    expect(raw).toContain('@apply p-4')
  })
})

describe('expandDirectives: диагностика ошибок (AUDIT C8)', () => {
  /**
   * Компонент с ошибкой в CSS. Триггер — `theme()` с несуществующим путём:
   * `@apply` неизвестного класса трансформер молча оставляет как есть,
   * а `theme()` бросает.
   */
  const broken = defineGranularProvider({
    id: 'broken',
    contractVersion: 1,
    packageBaseUrl: 'file:///broken/',
    components: [
      {
        name: 'C',
        safelist: [],
        cssFiles: [`data:text/css,${encodeURIComponent('.x{ color: theme("colors.nope.500") }')}`],
      },
    ],
  })

  it('сообщает об ошибке В CSS, а не о «нет зависимостей», и повторяет её каждый раз', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const options = { providers: [broken], components: 'all' as const, expandDirectives: true }
    const first = await getNodePreflightCss(options)
    const second = await getNodePreflightCss({ ...options })

    // CSS не потерян — вернулся как есть.
    expect(first).toContain('theme("colors.nope.500")')
    expect(second).toContain('theme("colors.nope.500")')

    const messages = warn.mock.calls.map(c => String(c[0]))
    // Раньше здесь было бы «нужны разрешимые 'unocss' и 'magic-string'»,
    // причём ровно один раз за процесс.
    expect(messages.every(m => !m.includes('не удалось загрузить трансформер'))).toBe(true)
    expect(messages.filter(m => m.includes('ошибка при раскрытии'))).toHaveLength(2)
    expect(messages.some(m => m.includes('colors.nope.500'))).toBe(true)

    warn.mockRestore()
  })
})
