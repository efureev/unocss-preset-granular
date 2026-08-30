import { createApp } from 'vue'

import App from './App.vue'

/*
 * Три раздельных импорта дают три отдельных CSS-ассета — `reset-*.css`,
 * `granular-*.css`, `app-*.css`. Без этого расщепления фундамент, утилиты и
 * ресет лежали бы одним файлом, и приписать байты слою было бы нечем.
 */
await Promise.all([
  import('./reset'),
  import('./granular'),
  import('./app'),
])

createApp(App).mount('#app')
