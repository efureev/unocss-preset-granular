import { createApp } from 'vue'

import App from './App.vue'

// Ровно один CSS-импорт — тот же, что и у `bench-one`. Всё остальное там
// приходит от пресета, и разница между стендами есть эта добавка.
await import('./reset')

createApp(App).mount('#app')
