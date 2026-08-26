import {createApp} from 'vue'
import '@unocss/reset/tailwind-compat.css'
import 'virtual:uno.css'

// Тема применяется до первого рендера — иначе на старте мелькнёт чужая.
import './theme'
// Строки: сверка манифеста с реально написанными импортами (см. strings.ts).
import './strings'
import App from './App.vue'

createApp(App).mount('#app')
