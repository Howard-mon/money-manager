import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { Quasar, Dark, Notify, Dialog } from 'quasar'
import '@quasar/extras/material-icons/material-icons.css'
import 'quasar/src/css/index.sass'
import '@vuepic/vue-datepicker/dist/main.css'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-tw.js'
import App from './App.vue'
import router from './router.js'

dayjs.locale('zh-tw')
createApp(App)
  .use(createPinia())
  .use(Quasar, { plugins: { Dark, Notify, Dialog }, config: { dark: true, brand: { primary: '#a8eea0' } } })
  .use(router)
  .mount('#app')
