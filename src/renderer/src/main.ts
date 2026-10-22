import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'
import { applyTheme } from './composables/useSettings'

// 挂载前先应用主题，避免深色启动时首帧出现浅色闪烁
applyTheme(window.api.settings.initialTheme)

createApp(App).mount('#app')
