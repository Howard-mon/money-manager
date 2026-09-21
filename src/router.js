import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from './stores/auth.js'
import LoginView from './views/LoginView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('./views/DashboardView.vue'), meta: { requiresAuth: true } },
    { path: '/join/:code', redirect: (to) => ({ path: '/', query: { join: to.params.code } }) },
    { path: '/login', component: LoginView },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  await auth.init()
  if (to.meta.requiresAuth && !auth.user) return { path: '/login', query: { redirect: to.fullPath } }
  if (to.path === '/login' && auth.user) return '/'
})

export default router
