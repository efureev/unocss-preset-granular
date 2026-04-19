import {fileURLToPath, URL} from 'node:url'
import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'

export const simplePkgDistDir = fileURLToPath(new URL('../../packages/simple-package/dist/', import.meta.url))
export const resetChunkGroup = {
    name: 'reset',
    test: /node_modules[\\/]@unocss[\\/]reset[\\/]/,
    priority: 1,
}
export const vueChunkGroup = {
    name: 'vue',
    test: /node_modules[\\/](?:vue|@vue)[\\/]/,
    priority: 3,
}
export const simplePkgChunkGroup = {
    name: 'spkg',
    test: (id: string) => id.startsWith(simplePkgDistDir),
    priority: 2,
}

export default defineConfig({
    root: fileURLToPath(new URL('./', import.meta.url)),
    base: '/app-1/',
    build: {
        rolldownOptions: {
            output: {
                codeSplitting: {
                    groups: [
                        resetChunkGroup,
                        vueChunkGroup,
                        simplePkgChunkGroup,
                    ],
                },
            },
        },
    },
    plugins: [
        vue(),
        UnoCSS({
            configFile: fileURLToPath(new URL('./uno.config.ts', import.meta.url)),
        }),
    ],
})
