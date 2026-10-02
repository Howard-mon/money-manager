<script setup>
import { computed, ref, watch } from 'vue'
import { PAYMENT_ACCOUNT_KINDS, paymentKindLabel } from '../utils/payments.js'

const props = defineProps({ modelValue: Boolean, accounts: { type: Array, default: () => [] }, busy: Boolean })
const emit = defineEmits(['update:modelValue', 'save', 'toggle'])
const open = computed({ get: () => props.modelValue, set: (value) => emit('update:modelValue', value) })
const editingId = ref(null)
const name = ref('')
const kind = ref('credit_card')

watch(() => props.modelValue, (value) => { if (value) reset() })

function reset() {
  editingId.value = null
  name.value = ''
  kind.value = 'credit_card'
}

function edit(account) {
  editingId.value = account.id
  name.value = account.name
  kind.value = account.kind
}

function submit() {
  if (!name.value.trim()) return
  emit('save', { id: editingId.value, name: name.value.trim(), kind: kind.value })
  reset()
}
</script>

<template>
  <q-dialog v-model="open" position="bottom">
    <q-card class="sheet">
      <div class="sheet-head"><div><h2>繳款帳戶</h2><p>帳戶屬於目前帳本，成員都能選用。</p></div><q-btn flat round icon="close" aria-label="關閉" @click="open = false" /></div>
      <form @submit.prevent="submit">
        <q-input v-model="name" outlined dense maxlength="50" label="帳戶名稱" placeholder="例如：台新信用卡、房貸" />
        <q-select v-model="kind" :options="PAYMENT_ACCOUNT_KINDS" emit-value map-options outlined dense label="類型" behavior="menu" />
        <div class="form-actions">
          <q-btn v-if="editingId" flat no-caps label="取消編輯" @click="reset" />
          <q-btn type="submit" unelevated no-caps :loading="busy" :disable="!name.trim()" :label="editingId ? '儲存修改' : '新增帳戶'" />
        </div>
      </form>

      <div v-if="accounts.length" class="account-list">
        <div v-for="account in accounts" :key="account.id" class="account-row" :class="{ inactive: !account.active }">
          <div><strong>{{ account.name }}</strong><small>{{ paymentKindLabel(account.kind) }}<template v-if="!account.active"> · 已停用</template></small></div>
          <button type="button" @click="edit(account)">編輯</button>
          <q-toggle :model-value="account.active" color="primary" :aria-label="`${account.active ? '停用' : '啟用'} ${account.name}`" @update:model-value="emit('toggle', account.id, $event)" />
        </div>
      </div>
      <p v-else class="empty">還沒有帳戶。先新增常用的信用卡或房貸。</p>
    </q-card>
  </q-dialog>
</template>

<style lang="scss" scoped>
.sheet { width: 100%; max-width: 560px; max-height: 92svh; overflow: auto; background: #17202a; color: #f0f5f0; border-radius: 24px 24px 0 0; padding: 22px 22px 30px; }
.sheet-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
h2 { font-size: 20px; margin: 0; }
p { color: #9aaba4; font-size: 12px; margin: 5px 0 0; }
form { display: grid; gap: 10px; margin-top: 20px; }
.form-actions { display: flex; justify-content: flex-end; gap: 8px; }
.form-actions :last-child { background: #a8eea0; color: #17271b; font-weight: 700; }
.account-list { margin-top: 24px; border-top: 1px solid #28343d; }
.account-row { display: flex; align-items: center; gap: 10px; min-height: 58px; border-bottom: 1px solid #28343d; }
.account-row.inactive { opacity: .55; }
.account-row > div { min-width: 0; flex: 1; display: flex; flex-direction: column; }
.account-row strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.account-row small { color: #8ea198; font-size: 11px; }
.account-row button { border: 0; background: none; color: #a8eea0; font: inherit; font-size: 12px; cursor: pointer; }
.empty { text-align: center; padding: 24px 0 4px; }
</style>
