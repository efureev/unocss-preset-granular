import antfu from '@antfu/eslint-config'

export default antfu({
    type: 'lib',
    gitignore: true,
    typescript: true,
    unocss: false,
    vue: false,
    jsonc: false,
    yaml: false,
})