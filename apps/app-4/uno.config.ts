import {defineConfig, presetMini} from 'unocss'
import {granularContent, presetGranularNode, type PresetGranularNodeOptions} from '@feugene/unocss-preset-granular/node'
import {
    accessibilityRules,
    animationPreflights,
    animationRules,
    colorOpacityRules,
    filterRules,
    numericPreflights,
    numericRules,
    objectRules,
    spacingRules,
    spacingVariants,
    typographyRules,
} from '@feugene/unocss-mini-extra-rules'
import xSimplePkgProvider from '@feugene/simple-package/granular-provider/node'

const granularOptions: PresetGranularNodeOptions = {
    providers: [xSimplePkgProvider],
    // components: 'all',
    components: [
        '@feugene/simple-package:XNestedReverse',
    ],
    layer: 'granular',
    // themes: {
    //     names: ['light', 'dark']
    // }
    // Явно `false`, а не дефолт: правила ниже уже подключены напрямую из
    // `@feugene/unocss-mini-extra-rules`. С дефолтным `true` пресет тихо
    // подмешал бы ту же копию правил ещё раз — итоговый CSS не изменился бы
    // (UnoCSS дедуплицирует по тексту), но тогда app-4 перестал бы отличать
    // рабочий публичный экспорт пакета от сломанного: без прямого импорта
    // CSS всё равно собрался бы из внутренней копии пресета.
    includeExtraRules: false,
}

export default defineConfig({
    presets: [
        presetMini({
            variablePrefix: 'ds-',
        }),
        presetGranularNode(granularOptions),
    ],
    // Полный набор правил из `@feugene/unocss-mini-extra-rules` — все восемь
    // семейств, а не подмножество: spinner-анимация, bracket‑color с `/NN`
    // opacity, расширенные filter/backdrop‑filter утилиты, `font-variant-numeric`
    // (`tabular-nums` и соседи), `object-fit` и `object-position`,
    // Tailwind‑совместимые `space-*` / `divide-*`, `text-transform` и
    // `sr-only`/`not-sr-only`.
    // Раз `includeExtraRules: false` выше отключил внутреннюю копию пресета,
    // это единственный источник этих утилит в app-4 — неполный список здесь
    // молча потерял бы соответствующий CSS, а не дал ошибку.
    rules: [
        ...accessibilityRules,
        ...animationRules,
        ...colorOpacityRules,
        ...filterRules,
        ...numericRules,
        ...objectRules,
        ...spacingRules,
        ...typographyRules,
    ],
    variants: [
        ...spacingVariants,
    ],
    preflights: [
        ...animationPreflights,
        // Без него `tabular-nums` и соседи соберут `font-variant-numeric` из
        // необъявленных переменных — CSS сгенерируется, свойство не применится.
        ...numericPreflights,
    ],
    // `@unocss/vite` читает `content.filesystem` только из top-level user-config,
    // поэтому подключаем хелпер `granularContent` — он автоматически соберёт
    // globs по выбранным компонентам (+ их транзитивным `dependencies`) и
    // расширит `pipeline.include` до `.js`, чтобы extractor увидел утилитарные
    // классы в скомпилированных SFC‑чанках.
    content: granularContent(granularOptions),
})
