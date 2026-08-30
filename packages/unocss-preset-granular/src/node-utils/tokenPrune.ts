import type { ThemeTokenOverrides } from '../core/tokenLayers'
import type { ResolvedScanDir } from '../fs/resolveScanDirs'
import type { PresetGranularResolution } from '../preset'
import type { PresetGranularNodeOptions } from '../preset.node'
import type { CssDeclarationOccurrence } from './cssDeclarations'
import type { InlinedCssSource } from './inlinedCss'

import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import process from 'node:process'

import { collectTokenLayers } from '../core/tokenLayers'
import { inspectGranularTokenUsage } from '../fs/tokenUsage'
import { scanCssDeclarations } from './cssDeclarations'

/**
 * Режим обрезки.
 *
 *   - `off` (по умолчанию) — план не считается вовсе, эмиссия не меняется ни
 *     на байт и не читает ни одного лишнего файла;
 *   - `report` — план считается и отдаётся, CSS эмитится прежним;
 *   - `on` — план применяется.
 *
 * Рекомендованный порядок внедрения — `report`, посмотреть, `on`: пресет
 * видит только то, что ему показали, и список удаляемого — единственный
 * способ убедиться, что показали всё.
 */
export type GranularPruneMode = 'off' | 'report' | 'on'

/** Имя токена БЕЗ `--`; строка допускает `*` в конце. */
export type GranularKeepPattern = string | RegExp

export interface GranularPruneAppSources {
  /**
   * Директории исходников САМОГО приложения. Пресет о них не знает: он видит
   * компоненты провайдеров, а `bg-[var(--gr-primary)]` в `App.vue` — нет.
   *
   * Директории, а не globs: glob-зависимости в пакете нет, а заводить её ради
   * опции, выключенной по умолчанию, — плохая сделка. Обход рекурсивный, тем
   * же способом, что скан компонентов.
   */
  dirs?: readonly string[]
  /** Расширения файлов. По умолчанию — код, разметка и CSS приложения. */
  extensions?: readonly string[]
}

export interface GranularPruneTokensOptions {
  mode?: GranularPruneMode
  /** Токены, сохраняемые безусловно. */
  keep?: readonly GranularKeepPattern[]
  /** Сахар: `['gr-z-']` ≡ `keep: ['gr-z-*']`. */
  keepPrefixes?: readonly string[]
  appSources?: GranularPruneAppSources
  /** Учитывать имена токенов в строковых литералах JS/TS/Vue. По умолчанию `true`. */
  scanLiterals?: boolean
}

/** Почему токен сохранён. Порядок членов — по убыванию силы улики. */
export type TokenKeepReason
  = | { kind: 'usage' }
    | { kind: 'inlined-rule' }
    | { kind: 'component-css' }
    | { kind: 'override' }
    | { kind: 'structural' }
    | { kind: 'app-source' }
    | { kind: 'keep-pattern', pattern: string }
    | { kind: 'referenced-by', by: string }

/** Один инлайнимый файл вместе с прочитанным текстом. */
export interface PrunableSection {
  source: InlinedCssSource
  css: string
}

export interface GranularTokenPrunePlan {
  mode: GranularPruneMode
  /** Предикат для {@link pruneCssDeclarations}. */
  isKept: (token: string) => boolean
  kept: ReadonlyMap<string, TokenKeepReason>
  /** Объявленные в обрезаемых секциях токены, не попавшие в `kept`. */
  removable: readonly string[]
  /**
   * Шаблоны `keep` / `keepPrefixes` / `dynamicTokens`, не совпавшие НИ С ОДНИМ
   * объявленным токеном.
   *
   * Опечатка или протухшая строка: компонент перестал собирать имя в
   * рантайме, а объявление осталось. Само по себе это ничего не ломает —
   * и именно поэтому гниёт молча.
   */
  deadPatterns: readonly string[]
  /** Скан исходников приложения был настроен и что-то нашёл. */
  appSourcesScanned: number
}

const DEFAULT_APP_EXTENSIONS = ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'jsx', 'tsx', 'vue', 'html', 'css']

const VAR_USE_RE = /var\(\s*--([\w-]+)/g
const VAR_LITERAL_RE = /(['"`])(--[\w-]+)\1/g

function varUses(text: string): string[] {
  return [...text.matchAll(VAR_USE_RE)].map(m => m[1] as string)
}

function literalNames(text: string): string[] {
  return [...text.matchAll(VAR_LITERAL_RE)].map(m => (m[2] as string).slice(2))
}

/** Строковый шаблон в предикат: `'gr-z-*'` → префикс, иначе точное имя. */
function patternMatcher(pattern: GranularKeepPattern): (token: string) => boolean {
  if (pattern instanceof RegExp)
    return token => pattern.test(token)
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1)
    return token => token.startsWith(prefix)
  }
  return token => token === pattern
}

/** Все имена токенов из `themes.tokenOverrides`, обе формы записи. */
function overrideTokens(overrides: ThemeTokenOverrides | undefined): string[] {
  if (!overrides)
    return []
  const out: string[] = []
  for (const theme of Object.values(overrides)) {
    for (const [key, value] of Object.entries(theme ?? {})) {
      if (typeof value === 'string')
        out.push(key)
      else
        out.push(...Object.keys(value ?? {}))
    }
  }
  return out
}

function listFiles(dir: string, extensions: readonly string[]): string[] {
  const allowed = new Set(extensions.map(e => `.${e}`))
  try {
    return readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile() && allowed.has(extname(entry.name)))
      .map(entry => join(entry.parentPath, entry.name))
  }
  catch {
    // Директории нет — это конфигурация приложения, и ронять из-за неё
    // сборку нельзя. Отсутствие видно по `appSourcesScanned: 0` в отчёте.
    return []
  }
}

const appScanCache = new WeakMap<PresetGranularNodeOptions, { tokens: Set<string>, files: number }>()

/**
 * Токены, потребляемые исходниками САМОГО приложения.
 *
 * Седьмой кэш пресета по идентичности `options` — по тому же контракту, что
 * шесть существующих. Кэшируется именно он, а не план целиком: план зависит
 * ещё и от ТЕКСТА инлайнимых файлов, а тот меняется при правке в dev, не
 * меняя идентичности опций.
 */
export function inspectGranularAppTokenUsage(
  options: PresetGranularNodeOptions,
): { tokens: Set<string>, files: number } {
  const cached = appScanCache.get(options)
  if (cached)
    return cached

  const config = options.pruneTokens?.appSources
  const tokens = new Set<string>()
  let files = 0

  if (config?.dirs) {
    const extensions = config.extensions ?? DEFAULT_APP_EXTENSIONS
    for (const dir of config.dirs) {
      for (const file of listFiles(resolve(process.cwd(), dir), extensions)) {
        let text: string
        try {
          text = readFileSync(file, 'utf8')
        }
        catch {
          continue
        }
        files++
        // Экранирование снимается: в CSS приложения утилита записана как
        // `.bg-\[var\(--x\)\]`, и без этого её токен не найдётся.
        const unescaped = text.replace(/\\(.)/g, '$1')
        for (const token of varUses(unescaped))
          tokens.add(token)
        if (options.pruneTokens?.scanLiterals !== false && !file.endsWith('.css')) {
          for (const token of literalNames(text))
            tokens.add(token)
        }
      }
    }
  }

  const result = { tokens, files }
  appScanCache.set(options, result)
  return result
}

/** Текст без указанных диапазонов. */
function stripRanges(text: string, ranges: readonly CssDeclarationOccurrence[]): string {
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  let out = ''
  let cursor = 0
  for (const { start, end } of sorted) {
    if (start < cursor)
      continue
    out += text.slice(cursor, start)
    cursor = end
  }
  return out + text.slice(cursor)
}

/**
 * Строит план обрезки: какие токены сохраняются и почему.
 *
 * Значения структурных слоёв берутся из {@link collectTokenLayers} — той же
 * функции, из которой их сериализует эмиссия; здесь спрашивают уже
 * посчитанное `effective`, а не считают заново. Значения инлайнимых файлов
 * берутся текстовым сканером: он отвечает на другой вопрос — «какие байты в
 * файле объявляют токен», — и обязан видеть в том числе блоки внутри
 * at-rules, которых плоский разбор не выражает.
 *
 * Множество сохранённых ГЛОБАЛЬНО по темам: токен, использованный только
 * через значение в тёмной теме, обязан уцелеть и в светлой.
 */
export function planGranularTokenPrune(
  options: PresetGranularNodeOptions,
  resolution: PresetGranularResolution,
  scanDirs: readonly ResolvedScanDir[],
  input: { inlined: readonly PrunableSection[], componentCss: readonly string[] },
): GranularTokenPrunePlan {
  const mode = options.pruneTokens?.mode ?? 'off'
  const kept = new Map<string, TokenKeepReason>()
  const keep = (token: string, reason: TokenKeepReason): void => {
    if (!kept.has(token))
      kept.set(token, reason)
  }

  // R1/R2 — потребление выбранных компонентов (safelist, cssFiles, исходники,
  // строковые литералы).
  for (const token of inspectGranularTokenUsage(options, resolution, scanDirs).usage.keys())
    keep(token, { kind: 'usage' })

  // R3 — `var()` в ПРАВИЛАХ инлайнимых файлов и в компонентном CSS.
  //
  // Из обрезаемых файлов диапазоны объявлений вычитаются: иначе объявление,
  // которое мы собираемся удалить, удержало бы свой референт живым, и
  // замыкание никогда бы не сошлось к правде.
  const declarationsBySection = new Map<PrunableSection, CssDeclarationOccurrence[]>()
  for (const section of input.inlined) {
    const decls = scanCssDeclarations(section.css)
    declarationsBySection.set(section, decls)
    const prunable = section.source.kind !== 'base'
    const rulesOnly = prunable ? stripRanges(section.css, decls) : section.css
    for (const token of varUses(rulesOnly.replace(/\\(.)/g, '$1')))
      keep(token, { kind: 'inlined-rule' })
  }
  for (const css of input.componentCss) {
    for (const token of varUses(css.replace(/\\(.)/g, '$1')))
      keep(token, { kind: 'component-css' })
  }

  // R4 — все ключи `tokenOverrides`, сырые, до `strictTokens`. «Приложение
  // написало значение» — самостоятельный факт: отброшенный override и так
  // репортит doctor, а обрезка не вправе делать вид, что его не писали.
  for (const token of overrideTokens(options.themes?.tokenOverrides))
    keep(token, { kind: 'override' })

  // R5 — явные escape-hatch'и приложения и провайдера.
  const patterns: Array<{ label: string, match: (t: string) => boolean }> = []
  for (const pattern of options.pruneTokens?.keep ?? [])
    patterns.push({ label: String(pattern), match: patternMatcher(pattern) })
  for (const prefix of options.pruneTokens?.keepPrefixes ?? [])
    patterns.push({ label: `${prefix}*`, match: patternMatcher(`${prefix}*`) })
  // Динамические токены объявляют ВЫБРАННЫЕ компоненты, а не провайдер.
  //
  // Разница не косметическая: провайдерский список держал бы шкалу в каждом
  // приложении, включая те, где ни одного её потребителя нет. Обход по
  // `resolved.entries` делает объявление селективным ровно так же, как
  // `safelist` и `cssFiles` — то есть по тому же правилу, ради которого
  // гранулярный отбор и существует.
  for (const { provider, descriptor } of resolution.resolved.entries) {
    for (const pattern of descriptor.dynamicTokens ?? [])
      patterns.push({ label: `${provider.id}:${descriptor.name} → ${pattern}`, match: patternMatcher(pattern) })
  }

  // R6 — исходники приложения.
  const appScan = inspectGranularAppTokenUsage(options)
  for (const token of appScan.tokens)
    keep(token, { kind: 'app-source' })

  // R7 — токены, которым структурный слой дал значение.
  const layers = collectTokenLayers(resolution.themes, options.themes?.tokenOverrides, {
    strictTokens: options.themes?.strictTokens,
  })
  const values = new Map<string, string[]>()
  const addValue = (token: string, value: string): void => {
    const list = values.get(token)
    if (list)
      list.push(value)
    else
      values.set(token, [value])
  }
  for (const blocks of layers.values()) {
    for (const block of blocks) {
      for (const chain of block.tokens.values()) {
        if (chain.effective === undefined)
          continue
        keep(chain.token, { kind: 'structural' })
        addValue(chain.token, chain.effective)
      }
    }
  }

  // Значения из инлайнимых файлов — ВСЕ объявления каждого имени, включая те,
  // что внутри `@supports`. Объединение принципиально: производная роль
  // объявлена дважды — формулой со ссылками и литералом-фолбэком, — и
  // зависимость видна только в первой.
  const declaredInPrunable = new Set<string>()
  const allDeclared = new Set<string>()
  for (const [section, decls] of declarationsBySection) {
    const prunable = section.source.kind !== 'base'
    for (const decl of decls) {
      addValue(decl.token, decl.value)
      allDeclared.add(decl.token)
      if (prunable)
        declaredInPrunable.add(decl.token)
    }
  }

  // Шаблоны применяются ко всему, что объявлено, — включая `base`, который
  // не обрезается: удержать там нечего, но иначе шаблон, целящийся в
  // base-токен, ложно попал бы в мёртвые.
  //
  // Отмечаются ВСЕ совпавшие шаблоны, а причиной становится первый. Иначе
  // второй шаблон, покрывающий тот же токен, числился бы мёртвым.
  const usedPatterns = new Set<string>()
  for (const token of new Set([...allDeclared, ...values.keys()])) {
    let reason: string | undefined
    for (const pattern of patterns) {
      if (!pattern.match(token))
        continue
      usedPatterns.add(pattern.label)
      reason ??= pattern.label
    }
    if (reason !== undefined)
      keep(token, { kind: 'keep-pattern', pattern: reason })
  }

  // Замыкание по значениям. Цикл `--a: var(--b); --b: var(--a)` завершается
  // по множеству.
  const queue = [...kept.keys()]
  while (queue.length > 0) {
    const token = queue.pop() as string
    for (const value of values.get(token) ?? []) {
      for (const referenced of varUses(value)) {
        if (!kept.has(referenced)) {
          kept.set(referenced, { kind: 'referenced-by', by: token })
          queue.push(referenced)
        }
      }
    }
  }

  const removable = [...declaredInPrunable].filter(token => !kept.has(token)).sort()

  return {
    mode,
    isKept: token => kept.has(token),
    kept,
    removable,
    deadPatterns: patterns.map(p => p.label).filter(label => !usedPatterns.has(label)),
    appSourcesScanned: appScan.files,
  }
}
