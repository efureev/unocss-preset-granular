import {createApp} from 'vue'
import '@unocss/reset/tailwind-compat.css'
import 'virtual:uno.css'

// Тема применяется до первого рендера — иначе на старте мелькнёт чужая.
import './theme'
// Строки: именованные импорты локалей. Словари подгружаются сразу, иначе их
// динамические `import()` недостижимы и Rollup выбросит языки из сборки.
import {dictionaries} from './strings'
import App from './App.vue'

void dictionaries

createApp(App).mount('#app')
