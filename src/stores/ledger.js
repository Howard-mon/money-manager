import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import dayjs from 'dayjs'
import { supabase } from '../supabase.js'

// ponytail: last-opened ledger is a per-browser convenience; membership is re-checked on every load.
function savedLedgerId() { try { return localStorage.getItem('ledgerId') } catch { return null } }
function rememberLedger(id) { try { localStorage.setItem('ledgerId', id) } catch { /* storage blocked */ } }
export function nameFor(user) { return user?.email?.split('@')[0].slice(0, 30) || '我' }

export const useLedgerStore = defineStore('ledger', () => {
  const ledgers = ref([])
  const currentId = ref(null)
  const transactions = ref([])
  const payments = ref([])
  const settlements = ref([])
  const statements = ref([])
  const loading = ref(false)
  const lineUser = ref(null)
  const lineGroups = ref([])
  const current = computed(() => ledgers.value.find((item) => item.id === currentId.value) ?? null)
  const members = computed(() => current.value?.ledger_members ?? [])
  let latestLoad = 0

  async function rpc(name, args) {
    const { data, error } = await supabase.rpc(name, args)
    if (error) throw error
    return data
  }

  async function fetchLedgers() {
    const { data, error } = await supabase.from('ledgers')
      .select('id, name, owner_id, invite_code, ledger_members(user_id, display_name)')
      .order('created_at')
      .order('joined_at', { referencedTable: 'ledger_members' })
    if (error) throw error
    return data
  }

  async function loadLedgers(user) {
    let data = await fetchLedgers()
    if (!data.length) {
      await rpc('create_ledger', { ledger_name: '我的帳本', member_name: nameFor(user) })
      data = await fetchLedgers()
    }
    ledgers.value = data
    const saved = savedLedgerId()
    currentId.value = data.some((item) => item.id === saved) ? saved : data[0].id
  }

  function selectLedger(id) {
    currentId.value = id
    rememberLedger(id)
  }

  async function createLedger(name, user) {
    rememberLedger(await rpc('create_ledger', { ledger_name: name, member_name: nameFor(user) }))
    await loadLedgers(user)
  }

  async function joinLedger(code, memberName, user) {
    rememberLedger(await rpc('join_ledger', { code, member_name: memberName }))
    await loadLedgers(user)
  }

  // display_name lives per membership, so renaming updates every ledger this user belongs to.
  async function renameMember(name, user) {
    const { error } = await supabase.from('ledger_members').update({ display_name: name }).eq('user_id', user.id)
    if (error) throw error
    await loadLedgers(user)
  }

  // Link state only: the browser can read its own line_users row and the group links of its ledgers.
  async function loadLineStatus() {
    const [{ data: me, error: meError }, { data: groups, error: groupError }] = await Promise.all([
      supabase.from('line_users').select('linked_at, default_ledger_id').maybeSingle(),
      supabase.from('line_groups').select('ledger_id, default_split_among, linked_at'),
    ])
    if (meError) throw meError
    if (groupError) throw groupError
    lineUser.value = me
    lineGroups.value = groups ?? []
  }

  async function createLineCode(kind, ledgerId, memberIds = []) {
    const rows = await rpc('create_line_link_code', { link_kind: kind, target_ledger: ledgerId ?? null, members: memberIds })
    return Array.isArray(rows) ? rows[0] : rows
  }

  async function load(month, userId) {
    const loadId = ++latestLoad
    loading.value = true
    try {
      const billingMonth = dayjs(month).startOf('month').format('YYYY-MM-DD')
      const inLedger = (table) => supabase.from(table).select('*').eq('ledger_id', currentId.value).eq('billing_month', billingMonth)
      const [tx, paid, settled, files] = await Promise.all([
        inLedger('transactions').order('spent_at', { ascending: false }),
        inLedger('payments').order('paid_at', { ascending: false }),
        inLedger('settlements').order('created_at'),
        supabase.storage.from('statements').list(`${userId}/${dayjs(month).format('YYYY-MM')}`, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } }),
      ])
      for (const result of [tx, paid, settled, files]) if (result.error) throw result.error
      if (loadId === latestLoad) {
        transactions.value = tx.data ?? []
        payments.value = paid.data ?? []
        settlements.value = settled.data ?? []
        // Storage keeps a 0-byte .emptyFolderPlaceholder when the last file in a folder is deleted.
        statements.value = (files.data ?? []).filter((file) => file.id && !file.name.startsWith('.'))
      }
    } finally {
      if (loadId === latestLoad) loading.value = false
    }
  }

  async function saveTransaction(record, userId) {
    const payload = { ...record, ledger_id: currentId.value, user_id: userId }
    const { error } = record.id
      ? await supabase.from('transactions').update(payload).eq('id', record.id)
      : await supabase.from('transactions').insert(payload)
    if (error) throw error
  }

  // Imported rows are paid by the importer; `shared` rows split evenly among everyone, the rest count only for the importer.
  async function importTransactions(rows, userId) {
    const everyone = members.value.map((member) => member.user_id)
    const { error } = await supabase.from('transactions').insert(rows.map(({ shared, source_card, ...row }) => ({
      ...row, merchant: row.merchant.trim(), amount: Math.round(Number(row.amount)), ledger_id: currentId.value, user_id: userId, paid_by: userId, split_among: shared ? everyone : [userId],
    })))
    if (error) throw error
  }

  async function deleteTransaction(id) {
    const { error } = await supabase.from('transactions').delete().eq('id', id)
    if (error) throw error
  }

  async function savePayment(record, userId) {
    const { error } = await supabase.from('payments').insert({ ...record, ledger_id: currentId.value, user_id: userId })
    if (error) throw error
  }

  async function deletePayment(id) {
    const { error } = await supabase.from('payments').delete().eq('id', id)
    if (error) throw error
  }

  async function saveSettlements(transfers, month) {
    const billingMonth = dayjs(month).startOf('month').format('YYYY-MM-DD')
    const { error } = await supabase.from('settlements').insert(transfers.map((t) => ({
      ledger_id: currentId.value, billing_month: billingMonth, from_user: t.from, to_user: t.to, amount: t.amount,
    })))
    if (error) throw error
  }

  async function deleteSettlement(id) {
    const { error } = await supabase.from('settlements').delete().eq('id', id)
    if (error) throw error
  }

  async function uploadStatement(file, month, userId) {
    if (!file.name.toLowerCase().endsWith('.pdf') || file.size > 10 * 1024 * 1024) {
      throw new Error('請選擇 10 MB 以下的 PDF 帳單')
    }
    const safeName = file.name.replace(/[^\w.-]/g, '_') // ponytail: Storage keys reject non-ASCII (InvalidKey)
    const path = `${userId}/${dayjs(month).format('YYYY-MM')}/${crypto.randomUUID()}-${safeName}`
    const { error } = await supabase.storage.from('statements').upload(path, file, { contentType: 'application/pdf' })
    if (error) throw error
  }

  async function statementUrl(path) {
    const { data, error } = await supabase.storage.from('statements').createSignedUrl(path, 60)
    if (error) throw error
    return data.signedUrl
  }

  return {
    ledgers, currentId, current, members, transactions, payments, settlements, statements, loading, lineUser, lineGroups,
    loadLedgers, selectLedger, createLedger, joinLedger, renameMember, load, loadLineStatus, createLineCode,
    saveTransaction, importTransactions, deleteTransaction, savePayment, deletePayment,
    saveSettlements, deleteSettlement, uploadStatement, statementUrl,
  }
})
