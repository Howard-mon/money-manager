import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'
import { guessCategory } from './import.js'
import { splitShares } from './split.js'

dayjs.extend(customParseFormat)

const METHOD_WORDS = {
  信用卡: 'card', 刷卡: 'card', 卡: 'card', card: 'card',
  現金: 'cash', 付現: 'cash', cash: 'cash',
  轉帳: 'transfer', 匯款: 'transfer', transfer: 'transfer',
}
const METHOD_LABELS = { card: '信用卡', cash: '現金', transfer: '轉帳' }
const RELATIVE_DAYS = { 今天: 0, 今日: 0, 昨天: -1, 昨日: -1, 前天: -2 }
// Card spending usually lands on the next statement; cash stays in the month it was spent.
const BILLING_SHIFT = { 下期: 1, 下期帳單: 1, 次期: 1, 本期: 0, 本期帳單: 0, 這期: 0 }

export const HELP_TEXT = [
  '記帳格式：記帳 [日期] 項目 金額 [付款方式] [分攤]',
  '',
  '例子：',
  '・記帳 今天，吃晚餐，1215元，分帳，現金',
  '・記帳 昨天 Uber 245 信用卡',
  '・記帳 9/20 Netflix 399 分類:訂閱',
  '・記帳 火鍋 1215 Elly付 Howard Elly平分',
  '・記帳 好市多 3200 卡片:台新 分帳',
  '',
  '日期：今天、昨天、9/20、2026/9/20，不寫就是今天',
  '付款方式：信用卡、現金、轉帳，不寫就是信用卡',
  '分攤：分帳（群組預設成員）、全部平分、某某 某某平分，不寫就只算付款人',
  '帳單：加「下期」會記到下一期帳單，適合今天刷的信用卡',
  '分類：分類:餐飲 或 #餐飲，不寫會自動判斷',
  '',
  '其他指令：撤銷、目前帳本、記帳說明',
].join('\n')

// LINE messages arrive with full-width punctuation and mixed separators; NFKC folds most of it.
// Thousands separators are joined first, or "1,215元" would split into two tokens.
function tokenize(text) {
  return text.normalize('NFKC').replace(/(\d),(?=\d{3}\b)/g, '$1').replace(/[、｜]/g, ' ').split(/[\s,|]+/).filter(Boolean)
}

function parseDate(token, today) {
  if (token in RELATIVE_DAYS) return dayjs(today).add(RELATIVE_DAYS[token], 'day')
  const full = dayjs(token, ['YYYY/M/D', 'YYYY-M-D'], true)
  if (full.isValid()) return full
  // Only slashes for the short form: "7-11" is a shop, not 7 July.
  if (/^\d{1,2}\/\d{1,2}$/.test(token)) {
    const [month, day] = token.split('/')
    const guess = dayjs(`${dayjs(today).year()}-${month}-${day}`, 'YYYY-M-D', true)
    if (guess.isValid()) return guess
  }
  return null
}

function parseAmount(token) {
  const cleaned = token.replace(/^NT\$?/i, '').replace(/(元|塊|NTD)$/i, '').replace(/,/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null
  const amount = Math.round(Number(cleaned))
  return amount === 0 ? null : amount
}

// context: { members: [{ user_id, display_name }], defaultSplit: [userId], senderUserId, today }
export function parseExpense(text, context) {
  const { members = [], defaultSplit = [], senderUserId, today = new Date() } = context
  const byName = new Map()
  const ambiguous = new Set()
  for (const member of members) {
    const name = member.display_name.trim()
    if (byName.has(name)) ambiguous.add(name)
    byName.set(name, member.user_id)
  }
  const findMember = (name) => {
    if (ambiguous.has(name)) return { error: `帳本裡有多位成員叫「${name}」，請先到網站改成不同的顯示名稱。` }
    const id = byName.get(name)
    if (!id) return { error: `找不到成員「${name}」。目前成員：${[...byName.keys()].join('、')}` }
    return { id }
  }

  const tokens = tokenize(text)
  const leftovers = []
  let amountIndex = -1
  let spentAt = null
  let amount = null
  let method = null
  let category = null
  let cardName = null
  let payerName = null
  let splitMode = null
  let splitNames = null
  let billingShift = 0

  for (const [index, token] of tokens.entries()) {
    if (!spentAt) {
      const date = parseDate(token, today)
      if (date) { spentAt = date; continue }
    }
    if (amount === null) {
      const value = parseAmount(token)
      if (value !== null) { amount = value; amountIndex = index; continue }
    }
    const lower = token.toLowerCase()
    if (METHOD_WORDS[token] || METHOD_WORDS[lower]) { method = METHOD_WORDS[token] ?? METHOD_WORDS[lower]; continue }
    const tagged = token.match(/^(分類|類別)[:：](.+)$/) ?? token.match(/^#(.+)$/)
    if (tagged) { category = tagged[tagged.length - 1]; continue }
    const card = token.match(/^(卡片|卡別|信用卡)[:：](.+)$/)
    if (card) { cardName = card[2]; continue }
    if (token in BILLING_SHIFT) { billingShift = BILLING_SHIFT[token]; continue }
    if (token === '分帳' || token === '平分') { splitMode = 'default'; continue }
    if (token === '全部平分' || token === '全部分帳' || token === '大家平分') { splitMode = 'all'; continue }
    const named = token.match(/^(.+?)平分$/)
    if (named) { splitMode = 'names'; splitNames = [named[1]]; continue }
    const payer = token.match(/^(.+?)付$/)
    if (payer) { payerName = payer[1]; continue }
    leftovers.push({ token, index })
  }

  // "Howard Elly平分": the names sit just before the token carrying 平分. Anything left over after the
  // amount is treated as a name too, so a misspelt member fails loudly instead of ending up in the merchant.
  if (splitMode === 'names') {
    while (leftovers.length && leftovers[leftovers.length - 1].index > amountIndex) splitNames.unshift(leftovers.pop().token)
    while (leftovers.length && byName.has(leftovers[leftovers.length - 1].token)) splitNames.unshift(leftovers.pop().token)
  }

  const merchant = leftovers.map((item) => item.token).join(' ').trim().slice(0, 120)
  if (!merchant) return { error: '看不出消費項目，例如：記帳 午餐 120' }
  if (amount === null) return { error: '看不出金額，例如：記帳 午餐 120' }

  let paidBy = senderUserId
  if (payerName) {
    const found = findMember(payerName)
    if (found.error) return { error: found.error }
    paidBy = found.id
  }

  let splitAmong = [paidBy]
  if (splitMode === 'all') splitAmong = members.map((member) => member.user_id)
  else if (splitMode === 'default') splitAmong = defaultSplit.length ? [...defaultSplit] : members.map((member) => member.user_id)
  else if (splitMode === 'names') {
    const ids = []
    for (const name of splitNames) {
      const found = findMember(name)
      if (found.error) return { error: found.error }
      if (!ids.includes(found.id)) ids.push(found.id)
    }
    splitAmong = ids
  }
  if (!splitAmong.length) return { error: '找不到要分攤的成員，請改用「全部平分」或指定成員。' }

  const date = spentAt ?? dayjs(today)
  return {
    record: {
      spent_at: date.format('YYYY-MM-DD'),
      billing_month: date.startOf('month').add(billingShift, 'month').format('YYYY-MM-DD'),
      merchant,
      amount,
      category: category ?? guessCategory(merchant),
      card_name: (method ?? 'card') === 'card' ? cardName : null,
      method: method ?? 'card',
      paid_by: paidBy,
      split_among: splitAmong,
      source: 'line',
    },
  }
}

export function formatReceipt({ ledgerName, record, members }) {
  const nameOf = (id) => members.find((member) => member.user_id === id)?.display_name ?? '成員'
  const shares = splitShares(record)
  const lines = [
    `已記到「${ledgerName}」`,
    `${record.merchant}　NT$ ${record.amount.toLocaleString('zh-TW')}`,
    `${dayjs(record.spent_at).format('M/D')}・${record.category}${record.card_name ? `・${record.card_name}` : ''}`,
    `${nameOf(record.paid_by)}付・${METHOD_LABELS[record.method]}・計入 ${dayjs(record.billing_month).format('M 月')}帳單`,
  ]
  if (record.split_among.length > 1) {
    lines.push(`分攤：${record.split_among.map((id) => `${nameOf(id)} ${shares[id].toLocaleString('zh-TW')}`).join('、')}`)
  }
  lines.push('打錯了？回覆「撤銷」可刪除這筆。')
  return lines.join('\n')
}
