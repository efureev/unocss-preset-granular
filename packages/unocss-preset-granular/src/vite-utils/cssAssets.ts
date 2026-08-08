import type {
  GranularComponentDescriptor,
  GranularProvider,
  GranularThemeTokenRef,
} from '../contract'
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/**
 * Ошибка размещения задекларированного CSS в `dist`.
 *
 * Отдельный класс, а не голый `Error`: сборка провайдера падает на ней
 * ДО публикации, и потребителю важно отличать её от ошибок бандлера.
 */
export class GranularCssAssetError extends Error {
  constructor(message: string, readonly subject: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'GranularCssAssetError'
  }
}

/**
 * Минимальная форма resolved-конфига Vite, которая нужна плагину.
 * Структурная — чтобы не тащить `vite` в зависимости пакета.
 */
export interface GranularResolvedConfigLike {
  root?: string
  build?: { outDir?: string }
}

/** Vite-плагин стадии сборки. Структурный тип, см. {@link GranularResolvedConfigLike}. */
export interface GranularBuildVitePlugin {
  name: string
  apply: 'build'
  configResolved: (config: GranularResolvedConfigLike) => void
  closeBundle: () => Promise<void>
}

export interface GranularCssAssetsOptions {
  /**
   * Провайдеры целиком: плагин возьмёт и `theme.tokenDefinitionsRef`
   * провайдера, и рефы/`cssFiles` всех его компонентов.
   */
  providers?: readonly GranularProvider[]
  /**
   * Отдельные дескрипторы компонентов — когда собирать весь провайдер
   * в `vite.config.ts` нежелательно.
   */
  components?: readonly GranularComponentDescriptor[]
  /**
   * Что делать, если исходник ссылки не читается либо ссылку невозможно
   * разместить. По умолчанию `'error'`: молча опубликовать битую ссылку
   * хуже, чем не собраться.
   */
  onMissing?: 'error' | 'warn'
  /**
   * Куда складывать. По умолчанию — `build.outDir` из конфига Vite.
   * Абсолютный путь либо путь относительно `root`.
   */
  outDir?: string
}

/** Одна единица работы: откуда взять файл и под каким именем положить. */
export interface GranularPlannedCopy {
  /** Абсолютный путь к исходнику. */
  from: string
  /** Имя ассета относительно корня `dist`. */
  assetName: string
  /** Человекочитаемый источник — для сообщений об ошибках. */
  subject: string
}

/** Ссылка, которую разместить нельзя, и почему. */
export interface GranularSkippedCopy {
  subject: string
  url: string
  /**
   * - `inlined-data-url` — бандлер уже вшил содержимое в чанк, копировать нечего
   *   (нормальная ситуация, не диагностируется);
   * - `no-asset-name` — у ссылки нет `assetName`, разместить её в `dist` некуда.
   *   Так выглядят package-wide ссылки `provider.theme.tokenDefinitionsRef`:
   *   `defineGranularProvider` — identity-функция и `assetName` не проставляет,
   *   поэтому такие ссылки обязаны быть в форме `new URL(...)`.
   */
  reason: 'inlined-data-url' | 'no-asset-name'
}

export interface GranularCopyPlan {
  copies: GranularPlannedCopy[]
  skipped: GranularSkippedCopy[]
}

/**
 * Vite-плагин: раскладывает по контрактным путям в `dist` тот CSS, который
 * конфиг провайдера ЗАДЕКЛАРИРОВАЛ, но бандлер не эмитит.
 *
 * Зачем. У ссылки на CSS (`tokenDefinitionsRef`, `cssFiles`) есть две формы
 * записи, и они не равнозначны:
 *
 * - `new URL('./themes/light.css', import.meta.url).href` — бандлер узнаёт
 *   ИМЕННО этот литерал и инлайнит содержимое файла как `data:text/css;base64`
 *   прямо в JS-чанк. Файл в `dist` не нужен, но CSS уезжает в бандл — а раз
 *   с появлением `tokenDefinitionsRef` конфиг компонента общий для browser-
 *   и node-entry, платит за это и клиентский бандл потребителя;
 * - `'./themes/light.css'` — просто данные. В бандл ничего лишнего не попадает,
 *   но и файл сам собой в `dist` не появляется: node-слой ищет его по
 *   `assetName`-фолбэку (`components/<Name>/<file>` от `packageBaseUrl`) и
 *   упирается в `ENOENT` у потребителя, который поставил опубликованный пакет.
 *
 * Плагин делает вторую форму полноценной: копирует исходник ровно туда, куда
 * указывает `assetName`, проставленный `define*`-хелперами. Никаких эвристик
 * по форме пути — план строится из самих дескрипторов, поэтому разъехаться
 * с контрактом он не может по построению.
 *
 * ```ts
 * // packages/<your-package>/vite.config.ts
 * import { granularCssAssetsPlugin } from '@feugene/unocss-preset-granular/vite'
 * import { myButtonConfig } from './src/components/MyButton/config'
 *
 * export default defineConfig({
 *   plugins: [vue(), granularCssAssetsPlugin({ components: [myButtonConfig] })],
 * })
 * ```
 */
export function granularCssAssetsPlugin(
  options: GranularCssAssetsOptions = {},
): GranularBuildVitePlugin {
  const onMissing = options.onMissing ?? 'error'
  let outDirAbs = ''

  const report = (message: string, subject: string, cause?: unknown): void => {
    if (onMissing === 'error')
      throw new GranularCssAssetError(message, subject, cause)
    console.warn(`[granular] ${message}`)
  }

  return {
    name: 'granular:css-assets',
    apply: 'build',

    configResolved(config) {
      const root = config.root ?? process.cwd()
      outDirAbs = resolve(root, options.outDir ?? config.build?.outDir ?? 'dist')
    },

    async closeBundle() {
      const { copies, skipped } = planGranularCssAssets(options)

      // `inlined-data-url` — штатный путь, о нём молчим. А вот ссылка, которую
      // разместить некуда, — это ровно тот тихий дефект, ради которого плагин
      // и заводился: у потребителя она обернётся ENOENT.
      for (const item of skipped) {
        if (item.reason === 'no-asset-name') {
          report(
            `granularCssAssetsPlugin: ${item.subject} references "${item.url}" but has no assetName, `
            + 'so it cannot be placed in dist. Use the new URL(..., import.meta.url) form for it.',
            item.subject,
          )
        }
      }

      for (const item of copies) {
        const dest = resolve(outDirAbs, item.assetName)

        // `assetName` приходит из дескриптора, но дескриптор пишет провайдер —
        // не даём ему вылезти за пределы `dist` относительным путём.
        if (relative(outDirAbs, dest).startsWith('..')) {
          throw new GranularCssAssetError(
            `granularCssAssetsPlugin: asset name "${item.assetName}" escapes the output directory`,
            item.subject,
          )
        }

        try {
          await mkdir(dirname(dest), { recursive: true })
          await copyFile(item.from, dest)
        }
        catch (cause) {
          report(
            `granularCssAssetsPlugin: cannot place CSS for ${item.subject}: `
            + `${item.from} → ${item.assetName}`,
            item.subject,
            cause,
          )
        }
      }
    },
  }
}

/**
 * Строит план размещения из дескрипторов — чистые данные, без обращений к FS.
 *
 * Экспортируется ради тестов и нестандартных сборок (rollup без Vite):
 * план можно исполнить чем угодно.
 */
export function planGranularCssAssets(options: GranularCssAssetsOptions): GranularCopyPlan {
  const copies: GranularPlannedCopy[] = []
  const skipped: GranularSkippedCopy[] = []
  const seen = new Set<string>()

  const add = (url: string, assetName: string | undefined, subject: string): void => {
    if (url.startsWith('data:')) {
      skipped.push({ subject, url: 'data:…', reason: 'inlined-data-url' })
      return
    }
    if (!assetName) {
      skipped.push({ subject, url, reason: 'no-asset-name' })
      return
    }

    const from = url.startsWith('file:') ? fileURLToPath(url) : url
    const key = `${from}\0${assetName}`
    if (seen.has(key))
      return
    seen.add(key)
    copies.push({ from, assetName, subject })
  }

  /**
   * Строковую форму нормализует только этот путь — package-wide ссылки
   * `provider.theme`, которые `defineGranularProvider` оставляет как есть.
   * У компонента ссылка уже объект: `defineGranularComponent` её развернула.
   */
  const addProviderRef = (
    ref: GranularThemeTokenRef | string,
    subject: string,
  ): void => {
    const normalized: GranularThemeTokenRef = typeof ref === 'string' ? { url: ref } : ref
    add(normalized.url, normalized.assetName, subject)
  }

  const addComponent = (component: GranularComponentDescriptor, providerId: string): void => {
    for (const [theme, ref] of Object.entries(component.tokenDefinitionsRef ?? {}))
      add(ref.url, ref.assetName, `${providerId}:${component.name} (theme "${theme}")`)

    // Симметрично — задекларированные `cssFiles` с их `cssFileAssetNames`.
    const files = component.cssFiles ?? []
    const names = component.cssFileAssetNames ?? []
    files.forEach((file, index) => {
      add(file, names[index], `${providerId}:${component.name} (cssFiles[${index}])`)
    })
  }

  for (const provider of options.providers ?? []) {
    for (const [theme, ref] of Object.entries(provider.theme?.tokenDefinitionsRef ?? {}))
      addProviderRef(ref, `${provider.id} (theme "${theme}")`)
    for (const component of provider.components ?? [])
      addComponent(component, provider.id)
  }

  for (const component of options.components ?? [])
    addComponent(component, '<components>')

  return { copies, skipped }
}
