import { createApp } from 'vue'

import App from './App.vue'

await Promise.all([
  import('./reset'),
  import('./granularity'),
  import('./app-styles'),
])

createApp(App).mount('#app')
