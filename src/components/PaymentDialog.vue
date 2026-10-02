<script setup>
import { computed, ref, watch } from 'vue'
import dayjs from 'dayjs'
import { VueDatePicker } from '@vuepic/vue-datepicker'

const props = defineProps({ modelValue: Boolean, month: { type: String, required: true }, busy: Boolean, accounts: { type: Array, default: () => [] } })
const emit = defineEmits(['update:modelValue', 'save', 'manage-accounts'])
const open = computed({ get: () => props.modelValue, set: (value) => emit('update:modelValue', value) })
const paidAt = ref(new Date())
const amount = ref('')
const accountId = ref(null)
const activeAccounts = computed(() => props.accounts.filter((account) => account.active))
watch(() => props.modelValue, (value) => {
  if (value) {
    paidAt.value = new Date()
    amount.value = ''
    if (!activeAccounts.value.some((account) => account.id === accountId.value)) accountId.value = activeAccounts.value[0]?.id ?? null
  }
})

function submit() {
  if (!accountId.value || !paidAt.value || !Number.isFinite(Number(amount.value)) || Number(amount.value) <= 0) return
  emit('save', { payment_account_id: accountId.value, paid_at: dayjs(paidAt.value).format('YYYY-MM-DD'), billing_month: dayjs(props.month).startOf('month').format('YYYY-MM-DD'), amount: Math.round(Number(amount.value)) })
}
</script>

<template>
  <q-dialog v-model="open" position="bottom">
    <q-card class="sheet">
      <div class="sheet-head"><h2>記錄繳款</h2><q-btn flat round icon="close" aria-label="關閉" @click="open = false" /></div>
      <form @submit.prevent="submit">
        <p>對應 {{ dayjs(month).format('YYYY 年 M 月') }}帳單</p>
        <template v-if="activeAccounts.length">
          <label>繳款帳戶</label>
          <q-select v-model="accountId" :options="activeAccounts" option-value="id" option-label="name" emit-value map-options outlined dense behavior="menu" />
        </template>
        <div v-else class="account-empty">
          <span>請先建立房貸或銀行信用卡等繳款帳戶。</span>
          <button type="button" @click="emit('manage-accounts')">建立帳戶</button>
        </div>
        <label>繳款日期</label>
        <VueDatePicker v-model="paidAt" dark :enable-time-picker="false" format="yyyy/MM/dd" auto-apply />
        <label>繳款金額（TWD）</label>
        <q-input v-model="amount" outlined dense type="number" min="1" step="1" inputmode="numeric" placeholder="0" :rules="[(v) => Math.round(Number(v)) > 0 || '請輸入大於 0 的金額']" />
        <q-btn class="save" type="submit" unelevated no-caps :loading="busy" :disable="!accountId" label="儲存繳款" />
      </form>
    </q-card>
  </q-dialog>
</template>

<style lang="scss" scoped>
.sheet { width: 100%; max-width: 560px; background: #17202a; color: #f0f5f0; border-radius: 24px 24px 0 0; padding: 22px 22px 30px; }
.sheet-head { display: flex; align-items: center; justify-content: space-between; }
h2 { font-size: 20px; margin: 0; }
p { color: #9aaba4; }
label { display: block; color: #aebdb8; font-size: 12px; margin: 16px 0 8px; }
.save { width: 100%; background: #a8eea0; color: #17271b; font-weight: 700; height: 48px; border-radius: 12px; margin-top: 22px; }
.account-empty { display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #111922; border: 1px solid #2b3940; border-radius: 12px; padding: 12px; color: #aebdb8; font-size: 13px; }
.account-empty button { flex: 0 0 auto; border: 0; background: none; color: #a8eea0; font: inherit; cursor: pointer; }
</style>
