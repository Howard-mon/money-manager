<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuasar } from 'quasar'
import { useAuthStore } from '../stores/auth.js'
import { supabase } from '../supabase.js'

const router = useRouter()
const route = useRoute()
const $q = useQuasar()
const auth = useAuthStore()
const email = ref('')
const password = ref('')
const mode = ref('signin')
const busy = ref(false)
const message = ref('')
// Only in-app paths, e.g. an invite link that sent the user here.
const next = () => (typeof route.query.redirect === 'string' && /^\/(?!\/)/.test(route.query.redirect) ? route.query.redirect : '/')

function forgotPassword() {
  $q.dialog({
    title: '重設密碼',
    message: '輸入註冊時使用的電子郵件，我們會寄出重設連結。',
    prompt: { model: email.value.trim(), type: 'email', isValid: (value) => /.+@.+\..+/.test(value.trim()) },
    cancel: true,
  }).onOk(async (value) => {
    try {
      await auth.sendPasswordReset(value.trim())
      message.value = '重設密碼的信已寄出，請到信箱點擊連結。若三分鐘內沒收到，請確認垃圾信件匣。'
    } catch (error) { $q.notify({ type: 'negative', message: error.message }) }
  })
}

async function submit() {
  message.value = ''
  busy.value = true
  try {
    if (mode.value === 'signup') {
      const data = await auth.signUp(email.value.trim(), password.value)
      if (data.session) await router.replace(next())
      else message.value = '註冊信已寄出，請到信箱完成驗證後登入。'
    } else {
      await auth.signIn(email.value.trim(), password.value)
      await router.replace(next())
    }
  } catch (error) {
    $q.notify({ type: 'negative', message: error.message })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="login-page">
    <div class="brand"><span class="brand-mark">◒</span> 搭夥帳</div>
    <section class="login-card">
      <div class="eyebrow">YOUR PRIVATE LEDGER</div>
      <h1>每一筆日常，<br /><em>都能看得清楚。</em></h1>
      <p class="intro">把信用卡消費、每月帳單與繳款記在同一處。</p>

      <div v-if="!supabase" class="setup-note">
        網站尚未連線到 Supabase。請先建立專案，並設定
        <code>VITE_SUPABASE_URL</code> 與 <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>。
      </div>
      <template v-else>
        <div class="mode-tabs" role="tablist" aria-label="登入方式">
          <button :class="{ active: mode === 'signin' }" role="tab" :aria-selected="mode === 'signin'" @click="mode = 'signin'">登入</button>
          <button :class="{ active: mode === 'signup' }" role="tab" :aria-selected="mode === 'signup'" @click="mode = 'signup'">建立帳號</button>
        </div>
        <form @submit.prevent="submit">
          <label for="email">電子郵件</label>
          <q-input id="email" v-model="email" outlined dense type="email" autocomplete="email" placeholder="name@example.com" :rules="[(v) => !!v || '請輸入電子郵件']" />
          <label for="password">密碼</label>
          <q-input id="password" v-model="password" outlined dense type="password" :autocomplete="mode === 'signup' ? 'new-password' : 'current-password'" placeholder="至少 8 個字元" :rules="[(v) => (v && v.length >= 8) || '至少 8 個字元']" />
          <button v-if="mode === 'signin'" type="button" class="link-button" @click="forgotPassword">忘記密碼？</button>
          <p v-if="message" class="success" role="status">{{ message }}</p>
          <q-btn class="submit" type="submit" unelevated no-caps :loading="busy" :label="mode === 'signup' ? '建立帳號' : '登入帳本'" />
        </form>
      </template>
    </section>
    <p class="footnote">你的資料僅供登入帳號查看。</p>
  </main>
</template>

<style lang="scss" scoped>
.login-page { min-height: 100svh; max-width: 520px; margin: auto; padding: 28px 22px; display: flex; flex-direction: column; }
.brand { display: flex; align-items: center; gap: 10px; color: #eef5ed; font-size: 18px; font-weight: 700; letter-spacing: .03em; }
.brand-mark { color: #a8eea0; font-size: 30px; line-height: 1; }
.login-card { margin: auto 0; padding: 36px 0; }
.eyebrow { color: #a8eea0; font-size: 11px; font-weight: 700; letter-spacing: .22em; }
h1 { margin: 18px 0 12px; font-size: clamp(34px, 10vw, 48px); line-height: 1.25; letter-spacing: -.04em; }
h1 em { color: #a8eea0; font-style: normal; }
.intro { color: #a8b7b2; margin: 0 0 34px; line-height: 1.7; }
.mode-tabs { display: flex; padding: 4px; border-radius: 14px; background: #1a222d; margin-bottom: 28px; }
.mode-tabs button { width: 50%; border: 0; background: transparent; color: #9eaaa9; padding: 11px; border-radius: 10px; cursor: pointer; font: inherit; }
.mode-tabs button.active { background: #303d42; color: #f5fff3; font-weight: 700; }
label { display: block; margin: 18px 0 8px; font-size: 13px; color: #cdd9d3; }
.submit { width: 100%; margin-top: 22px; background: #a8eea0; color: #17271b; height: 48px; border-radius: 12px; font-weight: 700; }
.success { color: #a8eea0; line-height: 1.7; }
.link-button { background: none; border: 0; color: #9fb3a6; font: inherit; font-size: 13px; padding: 6px 0; cursor: pointer; text-decoration: underline; }
.setup-note { padding: 18px; border: 1px solid #506648; border-radius: 14px; color: #d1dfd1; line-height: 1.8; overflow-wrap: anywhere; }
.footnote { text-align: center; color: #667672; font-size: 12px; }
</style>
