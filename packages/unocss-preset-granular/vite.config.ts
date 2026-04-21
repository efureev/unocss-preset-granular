import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

function getDistPackageJson() {
  const pkg = JSON.parse(
    readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
  )

  const stripDist = (value: unknown): unknown => {
    if (typeof value === 'string')
      return value.replace(/^\.\/dist\//, './')
    if (Array.isArray(value))
      return value.map(stripDist)
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, stripDist(v)]),
      )
    }
    return value
  }

  return {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    license: pkg.license,
    author: pkg.author,
    homepage: pkg.homepage,
    repository: pkg.repository,
    bugs: pkg.bugs,
    keywords: pkg.keywords,
    engines: pkg.engines,
    type: pkg.type,
    sideEffects: pkg.sideEffects,
    exports: stripDist(pkg.exports),
    peerDependencies: pkg.peerDependencies,
    peerDependenciesMeta: pkg.peerDependenciesMeta,
  }
}

export default defineConfig({
  plugins: [
    {
      name: 'unocss-preset-granular:emit-package-json',
      apply: 'build',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'package.json',
          source: `${JSON.stringify(getDistPackageJson(), null, 2)}\n`,
        })
      },
    },
  ],
  build: {
    target: 'esnext',
    reportCompressedSize: true,
    minify: false,
    lib: {
      entry: {
        index: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        node: fileURLToPath(new URL('./src/node.ts', import.meta.url)),
        contract: fileURLToPath(new URL('./src/contract/index.ts', import.meta.url)),
        vite: fileURLToPath(new URL('./src/vite.ts', import.meta.url)),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rolldownOptions: {
      external: [
        'node:buffer',
        'node:fs',
        'node:fs/promises',
        'node:path',
        'node:url',
        'unocss',
        '@unocss/core',
      ],
    },
  },
})
