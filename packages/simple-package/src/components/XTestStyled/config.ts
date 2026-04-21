import {defineGranularComponent} from '@feugene/unocss-preset-granular/contract'

import {splitClassTokens} from '../../utils/classTokens'
import {base} from "./dsStyles.ts";

export const xTestStyledConfig = defineGranularComponent(import.meta.url, {
    name: 'XTestStyled',
    dependencies: [],
    safelist: splitClassTokens(base),
})
