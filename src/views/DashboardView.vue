<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuasar } from 'quasar'
import dayjs from 'dayjs'
import { groupBy, sumBy } from 'lodash-es'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { LineChart, PieChart } from 'echarts/charts'
import { CanvasRenderer } from 'echarts/renderers'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { useAuthStore } from '../stores/auth.js'
import { nameFor, useLedgerStore } from '../stores/ledger.js'
import { CATEGORIES, parsePastedRows } from '../utils/import.js'
import { splitSummary } from '../utils/split.js'
import TransactionDialog from '../components/TransactionDialog.vue'
import PaymentDialog from '../components/PaymentDialog.vue'

use([PieChart, LineChart, CanvasRenderer, GridComponent, LegendComponent, TooltipComponent])
const router = useRouter()
const route = useRoute()
const $q = useQuasar()
const auth = useAuthStore()
const ledger = useLedgerStore()
const month = ref(dayjs().startOf('month').format('YYYY-MM-DD'))
const tab = ref('transactions')
const transactionOpen = ref(false)
const paymentOpen = ref(false)
const importOpen = ref(false)
const ledgerOpen = ref(false)
const accountOpen = ref(false)
const chartMode = ref('pie')
const displayName = ref('')
const newPassword = ref('')
const newLedgerName = ref('')
const editing = ref(null)
const busy = ref(false)
const paste = ref('')
const uploadedFile = ref(null)
const currency = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 })

const total = computed(() => sumBy(ledger.transactions, (tx) => Number(tx.amount)))
const paid = computed(() => sumBy(ledger.payments, (payment) => Number(payment.amount)))
const outstanding = computed(() => total.value - paid.value)
const grouped = computed(() => groupBy(ledger.transactions, 'spent_at'))
const parsed = computed(() => parsePastedRows(paste.value, month.value))
// Editable copy of the parsed rows; re-pasting or switching month starts over from the parser.
const draft = ref([])
watch(parsed, (result) => { draft.value = result.rows.map((row) => ({ ...row, shared: true })) })
const draftTotal = computed(() => sumBy(draft.value, (row) => Number(row.amount) || 0))
const draftValid = computed(() => draft.value.length > 0 && !parsed.value.errors.length && draft.value.every(rowValid))
const shared = computed(() => ledger.members.length > 1)
const summary = computed(() => splitSummary(ledger.transactions, ledger.settlements))
const inviteLink = computed(() => `${location.origin}/join/${ledger.current?.invite_code ?? ''}`)
const chartData = computed(() => {
  const byCategory = groupBy(ledger.transactions.filter((tx) => Number(tx.amount) > 0), 'category')
  return Object.entries(byCategory).map(([name, rows]) => ({ name, value: sumBy(rows, (tx) => Number(tx.amount)) }))
})
// Every day of the month, so gaps in spending stay visible instead of being collapsed.
const dailyTotals = computed(() => {
  const start = dayjs(month.value).startOf('month')
  const byDate = groupBy(ledger.transactions, 'spent_at')
  return Array.from({ length: start.daysInMonth() }, (_, index) => {
    const date = start.add(index, 'day').format('YYYY-MM-DD')
    return { date, label: start.add(index, 'day').format('M/D'), value: sumBy(byDate[date] ?? [], (tx) => Number(tx.amount)) }
  })
})
const pieOptions = computed(() => ({
  backgroundColor: 'transparent',
  color: ['#a8eea0', '#77c3b7', '#b6a2e5', '#ebbd7e', '#79a8df', '#e88f92', '#c4d192', '#d9a6c8', '#889796'],
  tooltip: { trigger: 'item', formatter: '{b}: NT$ {c} ({d}%)' },
  legend: { bottom: 0, icon: 'circle', textStyle: { color: '#b0bdb6', fontSize: 11 }, itemWidth: 8, itemHeight: 8 },
  series: [{ type: 'pie', radius: ['55%', '77%'], center: ['50%', '42%'], itemStyle: { borderColor: '#17202a', borderWidth: 3 }, label: { show: false }, data: chartData.value }],
}))
const lineOptions = computed(() => ({
  backgroundColor: 'transparent',
  grid: { left: 46, right: 14, top: 18, bottom: 26 },
  tooltip: { trigger: 'axis', formatter: (rows) => `${rows[0].axisValue}：${money(rows[0].data)}` },
  xAxis: { type: 'category', boundaryGap: false, data: dailyTotals.value.map((day) => day.label), axisLabel: { color: '#8d9f96', fontSize: 10, interval: 4 }, axisLine: { lineStyle: { color: '#26323a' } } },
  yAxis: { type: 'value', axisLabel: { color: '#8d9f96', fontSize: 10, formatter: (value) => (Math.abs(value) >= 1000 ? `${value / 1000}k` : value) }, splitLine: { lineStyle: { color: '#1e2b33' } } },
  series: [{ type: 'line', smooth: true, showSymbol: false, data: dailyTotals.value.map((day) => day.value), itemStyle: { color: '#a8eea0' }, areaStyle: { color: 'rgba(168, 238, 160, .12)' } }],
}))
const chartOptions = computed(() => (chartMode.value === 'pie' ? pieOptions.value : lineOptions.value))

watch([month, () => ledger.currentId], refresh)
watch(() => auth.recovering, (value) => {
  if (!value) return
  openAccount()
  $q.notify({ type: 'warning', message: '請設定新的密碼', timeout: 8000 })
})
onMounted(async () => {
  ledger.currentId = null // the store outlives this view; reset so re-opening the same ledger still reloads
  try {
    await ledger.loadLedgers(auth.user)
    if (typeof route.query.join === 'string') await askToJoin(route.query.join)
  } catch (error) { $q.notify({ type: 'negative', message: `讀取帳本失敗：${error.message}` }) }
})

function money(value) { return `NT$ ${currency.format(value)}` }
function balanceOf(id) { return summary.value.people[id] ?? { paid: 0, share: 0, net: 0 } }
function rowValid(row) { return !!row.merchant.trim() && typeof row.amount === 'number' && Number.isFinite(row.amount) && row.amount !== 0 }
function setAllShared(value) { for (const row of draft.value) row.shared = value }
function memberName(id) { return ledger.members.find((member) => member.user_id === id)?.display_name ?? '前成員' }
function shiftMonth(offset) { month.value = dayjs(month.value).add(offset, 'month').format('YYYY-MM-DD') }
async function refresh() {
  if (!auth.user || !ledger.currentId) return
  try { await ledger.load(month.value, auth.user.id) }
  catch (error) { $q.notify({ type: 'negative', message: `讀取資料失敗：${error.message}` }) }
}
function edit(tx = null) { editing.value = tx; transactionOpen.value = true }

async function saveTransaction(record) {
  busy.value = true
  try {
    await ledger.saveTransaction(record, auth.user.id)
    transactionOpen.value = false
    await refresh()
    $q.notify({ type: 'positive', message: '消費已儲存' })
  } catch (error) { $q.notify({ type: 'negative', message: error.message }) }
  finally { busy.value = false }
}
async function savePayment(record) {
  busy.value = true
  try {
    await ledger.savePayment(record, auth.user.id)
    paymentOpen.value = false
    await refresh()
    $q.notify({ type: 'positive', message: '繳款已記錄' })
  } catch (error) { $q.notify({ type: 'negative', message: error.message }) }
  finally { busy.value = false }
}
function confirmDelete(type, id) {
  $q.dialog({ title: '刪除紀錄？', message: '刪除後無法復原。', cancel: true, persistent: true }).onOk(async () => {
    try {
      if (type === 'transaction') await ledger.deleteTransaction(id)
      else if (type === 'settlement') await ledger.deleteSettlement(id)
      else await ledger.deletePayment(id)
      await refresh()
    } catch (error) { $q.notify({ type: 'negative', message: error.message }) }
  })
}
async function importRows() {
  if (!draftValid.value) return
  busy.value = true
  try {
    await ledger.importTransactions(draft.value, auth.user.id)
    importOpen.value = false
    paste.value = ''
    await refresh()
    $q.notify({ type: 'positive', message: '帳單資料已匯入' })
  } catch (error) { $q.notify({ type: 'negative', message: error.message }) }
  finally { busy.value = false }
}
async function upload() {
  if (!uploadedFile.value) return
  busy.value = true
  try {
    await ledger.uploadStatement(uploadedFile.value, month.value, auth.user.id)
    uploadedFile.value = null
    await refresh()
    $q.notify({ type: 'positive', message: 'PDF 已存入私人空間' })
  } catch (error) { $q.notify({ type: 'negative', message: error.message }) }
  finally { busy.value = false }
}
async function openStatement(file) {
  const tab = window.open('', '_blank')
  if (tab) tab.opener = null
  try {
    const path = `${auth.user.id}/${dayjs(month.value).format('YYYY-MM')}/${file.name}`
    const url = await ledger.statementUrl(path)
    if (tab) tab.location.href = url
    else $q.notify({ type: 'warning', message: '請允許此網站開啟新分頁，再試一次' })
  } catch (error) { tab?.close(); $q.notify({ type: 'negative', message: error.message }) }
}
function askToJoin(code) {
  router.replace({ query: {} })
  return new Promise((resolve) => {
    $q.dialog({
      title: '加入共享帳本',
      message: '你在這本帳本裡要顯示的名字（例如：媽媽、小明）',
      prompt: { model: nameFor(auth.user), type: 'text', isValid: (value) => value.trim().length >= 1 && value.trim().length <= 30 },
      cancel: true,
      persistent: true,
    }).onOk(async (name) => {
      try {
        await ledger.joinLedger(code, name.trim(), auth.user)
        $q.notify({ type: 'positive', message: `已加入「${ledger.current.name}」` })
      } catch (error) { $q.notify({ type: 'negative', message: error.message }) }
      resolve()
    }).onCancel(resolve)
  })
}
async function createLedger() {
  if (!newLedgerName.value.trim()) return
  busy.value = true
  try {
    await ledger.createLedger(newLedgerName.value.trim(), auth.user)
    newLedgerName.value = ''
    $q.notify({ type: 'positive', message: '帳本已建立，現在可以邀請家人了' })
  } catch (error) { $q.notify({ type: 'negative', message: error.message }) }
  finally { busy.value = false }
}
async function shareInvite() {
  try {
    if (navigator.share) await navigator.share({ title: `加入「${ledger.current.name}」`, url: inviteLink.value })
    else {
      await navigator.clipboard.writeText(inviteLink.value)
      $q.notify({ type: 'positive', message: '邀請連結已複製' })
    }
  } catch (error) {
    if (error.name !== 'AbortError') $q.notify({ type: 'warning', message: '無法自動複製，請手動複製上方連結' })
  }
}
function settleMonth() {
  const count = summary.value.transfers.length
  $q.dialog({ title: '完成月結？', message: `將 ${count} 筆轉帳記為已付款。之後若新增消費，會再算出新的差額。`, cancel: true }).onOk(async () => {
    try {
      await ledger.saveSettlements(summary.value.transfers, month.value)
      await refresh()
      $q.notify({ type: 'positive', message: '本月已結清' })
    } catch (error) { $q.notify({ type: 'negative', message: error.message }) }
  })
}
function openAccount() {
  displayName.value = ledger.members.find((member) => member.user_id === auth.user?.id)?.display_name ?? ''
  newPassword.value = ''
  accountOpen.value = true
}
async function saveDisplayName() {
  const name = displayName.value.trim()
  if (!name || name === ledger.members.find((member) => member.user_id === auth.user?.id)?.display_name) return
  busy.value = true
  try {
    await ledger.renameMember(name, auth.user)
    $q.notify({ type: 'positive', message: '顯示名稱已更新' })
  } catch (error) { $q.notify({ type: 'negative', message: error.message }) }
  finally { busy.value = false }
}
async function savePassword() {
  if (newPassword.value.length < 8) return
  busy.value = true
  try {
    await auth.updatePassword(newPassword.value)
    newPassword.value = ''
    accountOpen.value = false
    $q.notify({ type: 'positive', message: '密碼已更新' })
  } catch (error) { $q.notify({ type: 'negative', message: error.message }) }
  finally { busy.value = false }
}

async function logout() {
  try { await auth.signOut(); await router.replace('/login') }
  catch (error) { $q.notify({ type: 'negative', message: error.message }) }
}
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">◒</span>
        <q-select :model-value="ledger.currentId" :options="ledger.ledgers" option-value="id" option-label="name" emit-value map-options dense borderless aria-label="切換帳本" class="ledger-select" @update:model-value="ledger.selectLedger" />
      </div>
      <div><q-btn flat round icon="group_add" aria-label="帳本成員與邀請" @click="ledgerOpen = true" /><q-btn flat round icon="logout" aria-label="登出" @click="logout" /></div>
    </header>

    <main class="content">
      <div class="welcome"><div><p class="eyebrow">MONTHLY OVERVIEW</p><h1>這個月，花得有數。</h1></div><button class="avatar" aria-label="帳號設定" @click="openAccount">{{ auth.user?.email?.[0]?.toUpperCase() }}</button></div>

      <section class="month-panel" aria-label="選擇帳單月份">
        <q-btn flat round icon="chevron_left" aria-label="上個月" @click="shiftMonth(-1)" />
        <div><span>帳單月份</span><strong>{{ dayjs(month).format('YYYY 年 M 月') }}</strong></div>
        <q-btn flat round icon="chevron_right" aria-label="下個月" @click="shiftMonth(1)" />
      </section>

      <section class="balance-card" aria-label="本月支出摘要">
        <div class="balance-decor">✳</div>
        <p>本月信用卡支出</p>
        <div class="balance-value">{{ money(total) }}</div>
        <div class="balance-divider"></div>
        <div class="balance-row"><div><small>已記錄繳款</small><strong>{{ money(paid) }}</strong></div><div><small>支出減繳款</small><strong>{{ money(outstanding) }}</strong></div></div>
      </section>

      <div class="quick-actions">
        <button class="primary-action" @click="edit()"><span class="action-icon">＋</span><span>新增消費</span></button>
        <button @click="paymentOpen = true"><q-icon name="payments" size="20px" /><span>記錄繳款</span></button>
        <button @click="importOpen = true"><q-icon name="content_paste" size="20px" /><span>貼上帳單</span></button>
      </div>

      <div class="section-head"><h2>本月明細</h2><span>{{ ledger.transactions.length }} 筆消費</span></div>
      <nav class="tabs" aria-label="明細分類">
        <button :class="{ active: tab === 'transactions' }" @click="tab = 'transactions'">消費</button>
        <button :class="{ active: tab === 'payments' }" @click="tab = 'payments'">繳款</button>
        <button :class="{ active: tab === 'split' }" @click="tab = 'split'">分帳</button>
        <button :class="{ active: tab === 'statements' }" @click="tab = 'statements'">電子帳單</button>
      </nav>

      <div v-if="ledger.loading" class="empty"><q-spinner-dots color="primary" size="34px" /></div>
      <template v-else-if="tab === 'transactions'">
        <div v-if="!ledger.transactions.length" class="empty"><q-icon name="receipt_long" size="36px" /><p>這個月還沒有消費紀錄</p><button @click="edit()">新增第一筆</button></div>
        <section v-for="(rows, date) in grouped" :key="date" class="transaction-group">
          <h3>{{ dayjs(date).format('M 月 D 日・ddd') }}</h3>
          <div v-for="tx in rows" :key="tx.id" class="list-row">
            <div class="category-icon">{{ tx.category?.[0] || '記' }}</div>
            <div class="row-copy"><strong>{{ tx.merchant }}</strong><small>{{ tx.category }}<template v-if="tx.card_name"> · {{ tx.card_name }}</template><template v-if="shared"> · {{ memberName(tx.paid_by) }}付，{{ tx.split_among.length }} 人分</template></small></div>
            <div class="row-end"><strong>{{ money(tx.amount) }}</strong><div class="row-buttons"><button :aria-label="`編輯 ${tx.merchant}`" @click="edit(tx)">編輯</button><button :aria-label="`刪除 ${tx.merchant}`" @click="confirmDelete('transaction', tx.id)">刪除</button></div></div>
          </div>
        </section>
        <section v-if="chartData.length" class="chart-card">
          <div class="section-head">
            <h2>{{ chartMode === 'pie' ? '支出分類' : '每日支出' }}</h2>
            <div class="chart-toggle"><button :class="{ active: chartMode === 'pie' }" @click="chartMode = 'pie'">圓餅圖</button><button :class="{ active: chartMode === 'line' }" @click="chartMode = 'line'">折線圖</button></div>
          </div>
          <VChart class="chart" :option="chartOptions" autoresize />
        </section>
      </template>
      <template v-else-if="tab === 'payments'">
        <div v-if="!ledger.payments.length" class="empty"><q-icon name="payments" size="36px" /><p>尚未記錄繳款</p><button @click="paymentOpen = true">新增繳款</button></div>
        <div v-for="payment in ledger.payments" :key="payment.id" class="list-row payment-row"><div class="category-icon">✓</div><div class="row-copy"><strong>信用卡繳款</strong><small>{{ dayjs(payment.paid_at).format('YYYY/MM/DD') }}</small></div><div class="row-end"><strong>{{ money(payment.amount) }}</strong><button :aria-label="`刪除 ${payment.paid_at} 繳款`" @click="confirmDelete('payment', payment.id)">刪除</button></div></div>
      </template>
      <template v-else-if="tab === 'split'">
        <div v-if="!shared" class="empty"><q-icon name="group_add" size="36px" /><p>這本帳本目前只有你</p><button @click="ledgerOpen = true">建立家庭帳本並邀請家人</button></div>
        <template v-else>
          <div v-for="member in ledger.members" :key="member.user_id" class="list-row">
            <div class="category-icon">{{ member.display_name[0] }}</div>
            <div class="row-copy"><strong>{{ member.display_name }}</strong><small>已付 {{ money(balanceOf(member.user_id).paid) }} · 應分攤 {{ money(balanceOf(member.user_id).share) }}</small></div>
            <div class="row-end"><strong :class="{ owed: balanceOf(member.user_id).net > 0, owes: balanceOf(member.user_id).net < 0 }">{{ balanceOf(member.user_id).net > 0 ? '應收' : balanceOf(member.user_id).net < 0 ? '應付' : '已平衡' }} {{ money(Math.abs(balanceOf(member.user_id).net)) }}</strong></div>
          </div>
          <div class="section-head split-head"><h2>誰給誰</h2></div>
          <div v-if="!summary.transfers.length" class="settled"><q-icon name="task_alt" size="20px" /> 本月已結清，沒有待轉帳的款項</div>
          <div v-for="(transfer, index) in summary.transfers" :key="index" class="list-row"><div class="category-icon">→</div><div class="row-copy"><strong>{{ memberName(transfer.from) }} → {{ memberName(transfer.to) }}</strong><small>待轉帳</small></div><strong>{{ money(transfer.amount) }}</strong></div>
          <q-btn v-if="summary.transfers.length" class="settle-button" unelevated no-caps label="月結：全部記為已付款" @click="settleMonth" />
          <template v-if="ledger.settlements.length">
            <div class="section-head split-head"><h2>已記錄的轉帳</h2></div>
            <div v-for="item in ledger.settlements" :key="item.id" class="list-row"><div class="category-icon">✓</div><div class="row-copy"><strong>{{ memberName(item.from_user) }} → {{ memberName(item.to_user) }}</strong><small>{{ dayjs(item.created_at).format('YYYY/MM/DD') }} 記錄</small></div><div class="row-end"><strong>{{ money(item.amount) }}</strong><button :aria-label="`刪除 ${memberName(item.from_user)} 的轉帳紀錄`" @click="confirmDelete('settlement', item.id)">刪除</button></div></div>
          </template>
        </template>
      </template>
      <template v-else>
        <section class="upload-card"><h3>保存 PDF 帳單</h3><p>密碼鎖定的 PDF 可原樣保存；網站不會解密或讀取內容。每個檔案最多 10 MB。</p><input type="file" accept="application/pdf,.pdf" aria-label="選擇 PDF 帳單" @change="uploadedFile = $event.target.files?.[0] || null" /><q-btn :disable="!uploadedFile" :loading="busy" outline no-caps label="上傳帳單" @click="upload" /></section>
        <div v-if="!ledger.statements.length" class="empty"><q-icon name="picture_as_pdf" size="36px" /><p>本月還沒有保存的 PDF</p></div>
        <div v-for="file in ledger.statements" :key="file.id" class="list-row"><div class="category-icon">PDF</div><div class="row-copy"><strong>{{ file.name.replace(/^[0-9a-f-]{36}-/, '') }}</strong><small>私人檔案</small></div><q-btn flat round icon="open_in_new" :aria-label="`開啟 ${file.name}`" @click="openStatement(file)" /></div>
      </template>
    </main>

    <TransactionDialog v-model="transactionOpen" :transaction="editing" :month="month" :busy="busy" :members="ledger.members" :me="auth.user?.id" @save="saveTransaction" />
    <PaymentDialog v-model="paymentOpen" :month="month" :busy="busy" @save="savePayment" />
    <q-dialog v-model="importOpen" position="bottom">
      <q-card class="import-sheet">
        <div class="sheet-head"><h2>貼上帳單資料</h2><q-btn flat round icon="close" aria-label="關閉" @click="importOpen = false" /></div>
        <p>兩種格式都可以直接貼在下方，所有資料會歸入 {{ dayjs(month).format('YYYY 年 M 月') }}帳單：</p>
        <ul class="paste-formats"><li><strong>台新信用卡</strong>：在 PDF 帳單反白明細表（可含表頭與卡別那行），複製後貼上</li><li><strong>試算表</strong>：複製「日期、店家、金額」三欄，日期使用 YYYY/MM/DD</li></ul>
        <textarea v-model="paste" rows="7" placeholder="日期&#9;店家&#9;金額&#10;2026/09/01&#9;早餐&#9;85" aria-label="貼上試算表資料"></textarea>
        <p v-if="parsed.errors.length" class="error" role="alert">{{ parsed.errors.slice(0, 3).join('；') }}</p>
        <div v-else-if="draft.length" class="preview">
          <div class="preview-head">
            <strong>預覽：{{ draft.length }} 筆，合計 {{ money(draftTotal) }}</strong>
            <div v-if="shared" class="bulk-actions"><button type="button" @click="setAllShared(true)">全部分帳</button><button type="button" @click="setAllShared(false)">全部個人</button></div>
          </div>
          <div class="edit-list">
            <div v-for="(row, index) in draft" :key="index" class="edit-row" :class="{ invalid: !rowValid(row), personal: shared && !row.shared }">
              <span class="edit-date">{{ dayjs(row.spent_at).format('M/D') }}</span>
              <input v-model="row.merchant" class="edit-merchant" maxlength="120" :aria-label="`第 ${index + 1} 筆店家`" />
              <button type="button" class="edit-remove" :aria-label="`不匯入 ${row.merchant}`" @click="draft.splice(index, 1)"><q-icon name="close" size="16px" /></button>
              <input v-model.number="row.amount" class="edit-amount" type="number" step="0.01" :aria-label="`第 ${index + 1} 筆金額`" />
              <select v-model="row.category" class="edit-category" :aria-label="`第 ${index + 1} 筆分類`"><option v-for="name in CATEGORIES" :key="name">{{ name }}</option></select>
              <label v-if="shared" class="edit-share"><input v-model="row.shared" type="checkbox" />{{ row.shared ? '分帳' : '個人' }}</label>
            </div>
          </div>
          <details v-if="parsed.skipped?.length" class="skipped"><summary>略過 {{ parsed.skipped.length }} 行（繳上期卡款、利息等沒有日期的項目），需要的話請用「新增消費」補記</summary><div v-for="(line, index) in parsed.skipped" :key="index">{{ line }}</div></details><small>請確認月份與資料，重複貼上會產生重複紀錄。<template v-if="shared">付款人都記為你；「分帳」由全部成員平均分攤，「個人」只算你的。</template></small></div>
        <q-btn class="import-button" unelevated no-caps :disable="!draftValid" :loading="busy" :label="draft.length ? `確認匯入 ${draft.length} 筆` : '確認匯入'" @click="importRows" />
      </q-card>
    </q-dialog>
    <q-dialog v-model="accountOpen" position="bottom">
      <q-card class="import-sheet">
        <div class="sheet-head"><h2>帳號設定</h2><q-btn flat round icon="close" aria-label="關閉" @click="accountOpen = false" /></div>
        <p>登入帳號：{{ auth.user?.email }}</p>
        <h3 class="sheet-title">顯示名稱</h3>
        <p>家人在帳本裡看到的名字，所有帳本共用。</p>
        <form class="field-row" @submit.prevent="saveDisplayName"><q-input v-model="displayName" outlined dense maxlength="30" placeholder="例如：Howard" class="grow" /><q-btn type="submit" unelevated no-caps class="small-button" :loading="busy" :disable="!displayName.trim()" label="儲存" /></form>
        <h3 class="sheet-title">更改密碼</h3>
        <p>至少 8 個字元。更新後其他裝置仍保持登入。</p>
        <form class="field-row" @submit.prevent="savePassword"><q-input v-model="newPassword" outlined dense type="password" autocomplete="new-password" placeholder="新密碼" class="grow" /><q-btn type="submit" unelevated no-caps class="small-button" :loading="busy" :disable="newPassword.length < 8" label="更新" /></form>
      </q-card>
    </q-dialog>
    <q-dialog v-model="ledgerOpen" position="bottom">
      <q-card class="import-sheet">
        <div class="sheet-head"><h2>{{ ledger.current?.name }}</h2><q-btn flat round icon="close" aria-label="關閉" @click="ledgerOpen = false" /></div>
        <h3 class="sheet-title">成員</h3>
        <div class="member-chips"><span v-for="member in ledger.members" :key="member.user_id">{{ member.display_name }}<template v-if="member.user_id === auth.user?.id">（你）</template></span></div>
        <h3 class="sheet-title">邀請家人加入這本帳本</h3>
        <p>把連結傳給家人。對方登入或註冊後，就能一起記帳和分帳。拿到連結的人都能加入，請只傳給你信任的人。</p>
        <div class="field-row"><input :value="inviteLink" readonly aria-label="邀請連結" @focus="$event.target.select()" /><q-btn unelevated no-caps class="small-button" label="分享" @click="shareInvite" /></div>
        <h3 class="sheet-title">建立新帳本</h3>
        <p>例如另建一本「家庭帳本」，個人消費留在「我的帳本」，家人看不到。</p>
        <form class="field-row" @submit.prevent="createLedger"><q-input v-model="newLedgerName" outlined dense maxlength="40" placeholder="帳本名稱" class="grow" /><q-btn type="submit" unelevated no-caps class="small-button" :loading="busy" :disable="!newLedgerName.trim()" label="建立" /></form>
      </q-card>
    </q-dialog>
  </div>
</template>

<style lang="scss" scoped>
.app-shell { min-height: 100svh; background: #0d121a; }
.topbar { max-width: 980px; margin: auto; padding: 20px 22px 8px; display: flex; justify-content: space-between; align-items: center; }
.brand { display: flex; align-items: center; gap: 9px; font-weight: 700; font-size: 17px; }
.brand-mark { color: #a8eea0; font-size: 29px; line-height: 1; }
.ledger-select { min-width: 0; max-width: 60vw; font-weight: 700; font-size: 17px; }
.content { max-width: 940px; margin: auto; padding: 16px 22px 80px; }
.welcome { display: flex; justify-content: space-between; align-items: center; margin: 10px 0 26px; }
.eyebrow { color: #a8eea0; letter-spacing: .2em; font-weight: 700; font-size: 10px; margin: 0 0 7px; }
h1 { font-size: clamp(23px, 5vw, 34px); line-height: 1.3; letter-spacing: -.04em; margin: 0; }
.avatar { display: grid; place-items: center; width: 38px; height: 38px; flex: 0 0 38px; border-radius: 50%; background: #263832; color: #c1f2ad; font-weight: 700; border: 0; font-size: 15px; font-family: inherit; cursor: pointer; }
.month-panel { height: 62px; border: 1px solid #25323b; border-radius: 16px; display: flex; align-items: center; justify-content: space-between; background: #151d27; margin-bottom: 14px; }
.month-panel div { display: flex; align-items: baseline; gap: 12px; }
.month-panel span { color: #81948d; font-size: 12px; }
.month-panel strong { font-size: 17px; }
.balance-card { position: relative; overflow: hidden; background: linear-gradient(135deg, #253d33, #1d352f 54%, #233c48); border: 1px solid #3c5748; border-radius: 20px; padding: 23px 24px 22px; }
.balance-card p { color: #bdd8c7; font-size: 13px; margin: 0 0 12px; }
.balance-value { font-size: clamp(30px, 8vw, 47px); font-weight: 700; letter-spacing: -.045em; line-height: 1.2; }
.balance-decor { position: absolute; right: -8px; top: -35px; color: #ffffff0d; font-size: 165px; line-height: 1; }
.balance-divider { border-top: 1px solid #ffffff2b; margin: 22px 0 17px; }
.balance-row { display: flex; gap: 30px; }
.balance-row div { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.balance-row small { color: #acc6b5; font-size: 11px; }
.balance-row strong { font-size: 15px; }
.quick-actions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px; margin: 18px 0 36px; }
.quick-actions button { min-height: 74px; border: 1px solid #2b3940; background: #17212a; color: #d8e7dc; border-radius: 15px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; cursor: pointer; font: inherit; font-size: 12px; }
.quick-actions button.primary-action { background: #a8eea0; border-color: #a8eea0; color: #18281a; font-weight: 700; }
.action-icon { font-size: 24px; line-height: 20px; }
.section-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 15px; }
h2 { margin: 0; font-size: 19px; }
.section-head span { color: #84968e; font-size: 12px; }
.tabs { display: flex; gap: 24px; border-bottom: 1px solid #26323a; margin-bottom: 12px; }
.tabs button { border: 0; border-bottom: 2px solid transparent; padding: 0 0 13px; background: none; color: #889991; cursor: pointer; font: inherit; font-size: 14px; }
.tabs button.active { color: #a8eea0; border-color: #a8eea0; font-weight: 700; }
.empty { min-height: 180px; display: flex; align-items: center; justify-content: center; flex-direction: column; color: #799087; gap: 8px; text-align: center; }
.empty p { margin: 2px 0; }
.empty button { background: transparent; color: #a8eea0; border: 0; cursor: pointer; font: inherit; }
.transaction-group h3 { color: #8d9f96; font-size: 12px; font-weight: 500; margin: 14px 0 5px; }
.list-row { display: flex; align-items: center; gap: 10px; background: #151d26; border: 1px solid #1e2b33; border-radius: 11px; padding: 8px 11px; margin: 4px 0; min-width: 0; }
.category-icon { flex: 0 0 32px; height: 32px; display: grid; place-items: center; border-radius: 9px; background: #293831; color: #b7e7b0; font-size: 12px; font-weight: 700; }
.row-copy { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
.row-copy strong { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 14px; }
.row-copy small { color: #84978d; font-size: 11px; }
.row-end { flex: 0 0 auto; text-align: right; display: flex; flex-direction: column; gap: 2px; }
.row-end strong { font-size: 13px; }
.row-buttons { display: flex; justify-content: flex-end; gap: 9px; }
.chart-toggle { display: flex; gap: 4px; }
.chart-toggle button { border: 1px solid #2b3940; background: transparent; color: #9aaba4; border-radius: 999px; padding: 3px 11px; font: inherit; font-size: 12px; cursor: pointer; }
.chart-toggle button.active { background: #263832; border-color: #3c5748; color: #c1f2ad; font-weight: 700; }
.row-buttons button, .row-end > button { padding: 0; background: none; border: 0; color: #84978d; cursor: pointer; font-size: 11px; }
.chart-card { background: #151d26; border: 1px solid #1e2b33; padding: 16px; border-radius: 18px; margin-top: 18px; }
.chart { height: 260px; }
.upload-card { background: #151d26; border: 1px solid #25323b; border-radius: 16px; padding: 18px; display: flex; flex-direction: column; align-items: flex-start; gap: 12px; }
.upload-card h3 { margin: 0; font-size: 16px; }
.upload-card p { color: #9eada5; margin: 0; line-height: 1.6; font-size: 12px; }
.upload-card input { max-width: 100%; font-size: 12px; color: #c7d8cd; }
.import-sheet { width: 100%; max-width: 620px; max-height: 92svh; overflow: auto; background: #17202a; border-radius: 24px 24px 0 0; padding: 22px; }
.sheet-head { display: flex; align-items: center; justify-content: space-between; }
.import-sheet p { color: #a8b9ae; line-height: 1.65; font-size: 13px; }
.paste-formats { color: #a8b9ae; font-size: 12px; line-height: 1.7; margin: -4px 0 12px; padding-left: 18px; }
.import-sheet { color-scheme: dark; }
.preview-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; }
.bulk-actions { display: flex; gap: 6px; }
.bulk-actions button { border: 1px solid #3d4d4e; background: transparent; color: #cfe0d4; border-radius: 999px; padding: 4px 10px; font: inherit; font-size: 12px; cursor: pointer; }
.edit-list { max-height: 50svh; overflow-y: auto; border: 1px solid #26323a; border-radius: 10px; }
.edit-row { display: grid; grid-template-columns: 38px 1fr 104px auto; grid-template-areas: 'date merchant merchant remove' '. amount category share'; gap: 6px; align-items: center; padding: 8px 10px; border-bottom: 1px solid #1e2b33; }
.edit-row.personal { background: #1a1f2a; }
.edit-row.invalid { background: #3a1f22; }
.edit-row input:not([type=checkbox]), .edit-row select { min-width: 0; height: 32px; border: 1px solid #334244; border-radius: 8px; background: #0e151d; color: #f0f4ed; padding: 0 8px; font: inherit; font-size: 13px; }
.edit-date { grid-area: date; color: #8d9f96; }
.edit-merchant { grid-area: merchant; }
.edit-remove { grid-area: remove; display: grid; place-items: center; height: 32px; border: 0; background: none; color: #84978d; cursor: pointer; }
.edit-amount { grid-area: amount; text-align: right; }
.edit-category { grid-area: category; }
.edit-share { grid-area: share; display: flex; align-items: center; gap: 4px; color: #cfe0d4; white-space: nowrap; font-size: 12px; cursor: pointer; }
.edit-row.personal .edit-share { color: #8d9f96; }
.edit-share input { accent-color: #a8eea0; margin: 0; }
@media (max-width: 390px) { .edit-row { grid-template-columns: 32px 1fr 88px auto; } }
.skipped { color: #c9b98a; font-size: 12px; line-height: 1.6; }
.skipped summary { cursor: pointer; }
.skipped div { color: #a2ada1; overflow-wrap: anywhere; }
textarea { width: 100%; border: 1px solid #3d4d4e; border-radius: 11px; padding: 13px; background: #0e151d; color: #f0f4ed; font: 13px/1.6 monospace; resize: vertical; }
.import-sheet .error { color: #ffaaa0; }
.preview { margin-top: 13px; display: grid; gap: 7px; color: #dceade; font-size: 12px; }
.preview small { color: #a2ada1; }
.import-button { width: 100%; margin-top: 18px; background: #a8eea0; color: #17271b; height: 46px; border-radius: 12px; font-weight: 700; }
.owed { color: #a8eea0; }
.owes { color: #ffb4a8; }
.split-head { margin-top: 26px; }
.settled { display: flex; align-items: center; gap: 8px; color: #a8eea0; font-size: 13px; padding: 12px 0; }
.settle-button { width: 100%; margin-top: 12px; background: #a8eea0; color: #17271b; height: 46px; border-radius: 12px; font-weight: 700; }
.sheet-title { font-size: 14px; margin: 22px 0 6px; color: #dceade; }
.member-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.member-chips span { background: #263832; color: #c1f2ad; border-radius: 999px; padding: 5px 12px; font-size: 13px; }
.field-row { display: flex; gap: 8px; align-items: flex-start; }
.field-row input { flex: 1; min-width: 0; height: 40px; border: 1px solid #3d4d4e; border-radius: 10px; padding: 0 12px; background: #0e151d; color: #f0f4ed; font-size: 12px; }
.field-row .grow { flex: 1; }
.small-button { background: #a8eea0; color: #17271b; height: 40px; border-radius: 10px; font-weight: 700; }
@media (min-width: 700px) { .quick-actions { max-width: 540px; } .balance-card { max-width: 600px; } }
@media (max-width: 390px) { .month-panel div { gap: 5px; } .balance-row { gap: 16px; } .balance-row strong { font-size: 13px; } }
</style>
