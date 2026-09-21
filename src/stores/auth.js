import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '../supabase.js'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const recovering = ref(false)
  let initialising

  function init() {
    if (!initialising) {
      initialising = (async () => {
        if (!supabase) return
        supabase.auth.onAuthStateChange((event, session) => {
          user.value = session?.user ?? null
          // Arriving from a reset-password email: the session is valid but the password still needs replacing.
          if (event === 'PASSWORD_RECOVERY') recovering.value = true
        })
        const { data, error } = await supabase.auth.getSession()
        if (error) throw error
        user.value = data.session?.user ?? null
      })()
    }
    return initialising
  }

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  async function signUp(email, password) {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
    return data
  }

  async function updatePassword(password) {
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw error
    recovering.value = false
  }

  async function sendPasswordReset(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/` })
    if (error) throw error
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    user.value = null
  }

  return { user, recovering, init, signIn, signUp, updatePassword, sendPasswordReset, signOut }
})
