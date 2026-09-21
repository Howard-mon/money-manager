import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '../supabase.js'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  let initialising

  function init() {
    if (!initialising) {
      initialising = (async () => {
        if (!supabase) return
        supabase.auth.onAuthStateChange((_event, session) => {
          user.value = session?.user ?? null
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

  async function signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    user.value = null
  }

  return { user, init, signIn, signUp, signOut }
})
