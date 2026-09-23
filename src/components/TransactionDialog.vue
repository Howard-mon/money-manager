<script setup>
import { computed, ref, watch } from 'vue'
import dayjs from 'dayjs'
import { VueDatePicker } from '@vuepic/vue-datepicker'
import { CATEGORIES, METHODS } from '../utils/import.js'

const props = defineProps({ modelValue: Boolean, transaction: { type: Object, default: null }, month: { type: String, required: true }, busy: Boolean, members: { type: Array, default: () => [] }, me: { type: String, default: null } })
const emit = defineEmits(['update:modelValue', 'save'])
const open = computed({ get: () => props.modelValue, set: (value) => emit('update:modelValue', value) })
const spentAt = ref(new Date())
const merchant = ref('')
const amount = ref('')
const category = ref('餐飲')
const cardName = ref('')
const method = ref('card')
const note = ref('')
const paidBy = ref(null)
const splitAmong = ref([])
const memberOptions = computed(() => props.members.map((member) => ({ label: member.display_name, value: member.user_id })))
const shared = computed(() => props.members.length > 1)
const perPerson = computed(() => Math.round((Number(amount.value) / splitAmong.value.length) * 100) / 100)

watch(() => props.modelValue, (value) => {
  if (!value) return
  const tx = props.transaction
  spentAt.value = tx ? dayjs(tx.spent_at).toDate() : new Date()
  merchant.value = tx?.merchant ?? ''
  amount.value = tx?.amount ?? ''
  category.value = tx?.category ?? '餐飲'
  cardName.value = tx?.card_name ?? ''
  method.value = tx?.method ?? 'card'
  note.value = tx?.note ?? ''
  paidBy.value = tx?.paid_by ?? props.me
  splitAmong.value = tx?.split_among ?? props.members.map((member) => member.user_id)
})

function submit() {
  if (!spentAt.value || !merchant.value.trim() || !Number.isFinite(Number(amount.value)) || Number(amount.value) === 0 || !splitAmong.value.length) return
  emit('save', {
    ...(props.transaction?.id ? { id: props.transaction.id } : {}),
    spent_at: dayjs(spentAt.value).format('YYYY-MM-DD'),
    billing_month: dayjs(props.month).startOf('month').format('YYYY-MM-DD'),
    merchant: merchant.value.trim(),
    amount: Number(amount.value),
    category: category.value,
    method: method.value,
    card_name: method.value === 'card' ? cardName.value.trim() || null : null,
    note: note.value.trim() || null,
    paid_by: paidBy.value,
    split_among: splitAmong.value,
    source: props.transaction?.source ?? 'manual',
  })
}
</script>

<template>
  <q-dialog v-model="open" position="bottom">
    <q-card class="sheet">
      <div class="sheet-head"><h2>{{ transaction ? '編輯消費' : '新增消費' }}</h2><q-btn flat round icon="close" aria-label="關閉" @click="open = false" /></div>
      <form @submit.prevent="submit">
        <label>消費日期</label>
        <VueDatePicker v-model="spentAt" dark :enable-time-picker="false" format="yyyy/MM/dd" auto-apply />
        <label>店家／項目</label>
        <q-input v-model="merchant" outlined dense maxlength="120" placeholder="例如：午餐" :rules="[(v) => !!v?.trim() || '請輸入店家或項目']" />
        <label>金額（TWD，退款可輸入負數）</label>
        <q-input v-model="amount" outlined dense type="number" step="0.01" placeholder="0" :rules="[(v) => Number(v) !== 0 || '請輸入非零金額']" />
        <template v-if="shared">
          <label>誰付的</label>
          <q-select v-model="paidBy" outlined dense emit-value map-options :options="memberOptions" />
          <label>分給誰<template v-if="splitAmong.length && Number(amount)">（{{ splitAmong.length }} 人，每人約 NT$ {{ perPerson }}）</template></label>
          <q-option-group v-model="splitAmong" type="checkbox" inline :options="memberOptions" />
          <p v-if="!splitAmong.length" class="error" role="alert">至少選一位分攤成員</p>
        </template>
        <label>付款方式</label>
        <q-btn-toggle v-model="method" no-caps unelevated spread toggle-color="primary" text-color="white" color="dark" :options="METHODS" />
        <div class="row-fields">
          <div><label>分類</label><q-select v-model="category" outlined dense :options="CATEGORIES" /></div>
          <div v-if="method === 'card'"><label>信用卡暱稱</label><q-input v-model="cardName" outlined dense maxlength="50" placeholder="選填" /></div>
        </div>
        <label>備註</label>
        <q-input v-model="note" outlined dense maxlength="300" placeholder="選填" />
        <p class="hint">這筆消費會計入 {{ dayjs(month).format('YYYY 年 M 月') }}帳單。</p>
        <q-btn class="save" type="submit" unelevated no-caps :loading="busy" label="儲存消費" />
      </form>
    </q-card>
  </q-dialog>
</template>

<style lang="scss" scoped>
.sheet { width: 100%; max-width: 560px; max-height: 92svh; overflow-y: auto; background: #17202a; color: #f0f5f0; border-radius: 24px 24px 0 0; padding: 22px 22px 30px; }
.sheet-head { display: flex; align-items: center; justify-content: space-between; }
h2 { font-size: 20px; margin: 0; }
label { display: block; color: #aebdb8; font-size: 12px; margin: 16px 0 8px; }
.row-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.error { color: #ffaaa0; font-size: 12px; margin: 6px 0 0; }
.hint { color: #89a197; font-size: 12px; margin: 18px 0 0; }
.save { width: 100%; background: #a8eea0; color: #17271b; font-weight: 700; height: 48px; border-radius: 12px; margin-top: 20px; }
</style>
