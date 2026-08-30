// Опции стенда для CLI `granular`. Импортирует СОБРАННЫЙ провайдер — тот же,
// что видит сборка, а не исходники.
import heavyProvider from '@feugene/heavy-package/granular-provider/node'

export default {
  providers: [heavyProvider],
  components: [{ provider: '@feugene/heavy-package', names: ['XhPanel'] }],
  themes: { names: ['light', 'dark'] },
  layer: 'granular',
}
