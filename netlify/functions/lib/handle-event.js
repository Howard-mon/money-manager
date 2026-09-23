import { createHash } from 'node:crypto'
import { HELP_TEXT, formatReceipt, parseExpense } from '../../../src/utils/line-message.js'

const UNDO_WINDOW_MINUTES = 10
const CODE_PATTERN = /^[0-9A-F]{8}$/i

const NOT_LINKED = '這個 LINE 帳號還沒連結帳本。請到網站的「帳本設定 → 連結 LINE」產生綁定碼，再傳給我。'
const GROUP_NOT_LINKED = '這個群組還沒綁定帳本。請帳本建立者到網站產生「群組綁定碼」，並在這裡傳「綁定 ABCD1234」。'
const NOT_MEMBER = '你不是這本帳本的成員，請先請帳本建立者用邀請連結把你加入。'

export const hashCode = (code) => createHash('sha256').update(code.trim().toUpperCase(), 'utf8').digest('hex')

// A mention of the bot is stripped so "@bot 記帳 ..." parses like a plain message.
function cleanText(message) {
  let text = message.text ?? ''
  for (const mentionee of message.mention?.mentionees ?? []) {
    if (typeof mentionee.index === 'number' && typeof mentionee.length === 'number') {
      text = text.slice(0, mentionee.index) + ' '.repeat(mentionee.length) + text.slice(mentionee.index + mentionee.length)
    }
  }
  return text.trim()
}

function isHelp(text) { return ['記帳說明', '說明', '幫助', 'help', '?', '？'].includes(text.toLowerCase()) }

// event: a LINE webhook event. store: see lib/store.js. Returns the reply text, or null to stay silent.
export async function handleEvent(event, { store, now = new Date() }) {
  if (event.type !== 'message' || event.message?.type !== 'text') return null
  const source = event.source ?? {}
  const lineUserId = source.userId
  const isGroup = Boolean(source.groupId || source.roomId)
  const chatId = source.groupId ?? source.roomId ?? lineUserId
  if (!chatId) return null

  const text = cleanText(event.message)
  if (!text) return null
  const bindMatch = text.match(/^綁定\s*([0-9A-Za-z]{8})$/)
  const isExpense = text.startsWith('記帳')
  const isUndo = text === '撤銷' || text === '取消'
  const isStatus = text === '目前帳本' || text === '帳本'

  // Groups only react to bookkeeping traffic; everything else is normal chat.
  if (isGroup && !bindMatch && !isExpense && !isUndo && !isStatus && !isHelp(text)) return null
  if (isHelp(text)) return HELP_TEXT

  if (!lineUserId) return isGroup ? null : NOT_LINKED
  if (bindMatch || (!isGroup && CODE_PATTERN.test(text))) {
    return bindCode(bindMatch ? bindMatch[1] : text, { store, now, lineUserId, chatId, isGroup })
  }

  const linked = await store.getLineUser(lineUserId)
  if (!linked) return NOT_LINKED

  const ledgerId = isGroup ? (await store.getLineGroup(chatId))?.ledger_id : linked.default_ledger_id
  if (isGroup && !ledgerId) return GROUP_NOT_LINKED
  if (!ledgerId) return '還沒設定要記到哪一本帳本。請到網站的「帳本設定 → 連結 LINE」重新產生綁定碼。'

  const members = await store.getMembers(ledgerId)
  if (!members.some((member) => member.user_id === linked.user_id)) return NOT_MEMBER

  if (isUndo) return undo({ store, now, chatId, ledgerId, userId: linked.user_id })
  if (isStatus) return status({ store, ledgerId, members, isGroup, chatId })
  if (!isExpense) return HELP_TEXT
  return record({ store, now, event, chatId, ledgerId, members, linked, text, isGroup })
}

async function bindCode(code, { store, now, lineUserId, chatId, isGroup }) {
  const entry = await store.consumeCode(hashCode(code), now)
  if (!entry) return '綁定碼無效或已過期，請到網站重新產生一組。'
  if (isGroup) {
    if (entry.kind !== 'group') return '這是個人綁定碼，請在和我的一對一聊天室裡傳送。'
    const linked = await store.getLineUser(lineUserId)
    if (!linked || linked.user_id !== entry.issued_by) return '請由產生綁定碼的本人傳送，而且他要先完成個人綁定。'
    const ledger = await store.getLedger(entry.ledger_id)
    if (!ledger || ledger.owner_id !== entry.issued_by) return '只有帳本建立者可以綁定群組。'
    await store.linkGroup({
      lineGroupId: chatId,
      ledgerId: entry.ledger_id,
      defaultSplitAmong: entry.default_split_among ?? [],
      linkedBy: entry.issued_by,
    })
    return `這個群組已綁定帳本「${ledger.name}」。\n傳「記帳 午餐 120 分帳」就會記上去，傳「記帳說明」看完整格式。`
  }
  if (entry.kind !== 'group') {
    await store.linkUser({ lineUserId, userId: entry.issued_by, defaultLedgerId: entry.ledger_id ?? null })
    const ledger = entry.ledger_id ? await store.getLedger(entry.ledger_id) : null
    return `綁定完成${ledger ? `，預設記到「${ledger.name}」` : ''}。\n傳「記帳 午餐 120」試試看，傳「記帳說明」看完整格式。`
  }
  return '這是群組綁定碼，請在要綁定的 LINE 群組裡傳送。'
}

async function record({ store, now, event, chatId, ledgerId, members, linked, text, isGroup }) {
  const group = isGroup ? await store.getLineGroup(chatId) : null
  const parsed = parseExpense(text.replace(/^記帳/, ''), {
    members,
    defaultSplit: group?.default_split_among ?? [],
    senderUserId: linked.user_id,
    today: now,
  })
  if (parsed.error) return `${parsed.error}\n\n傳「記帳說明」看格式。`

  const ledger = await store.getLedger(ledgerId)
  const result = await store.insertTransaction({
    ...parsed.record,
    ledger_id: ledgerId,
    user_id: linked.user_id,
    line_event_id: event.webhookEventId ?? null,
    line_chat_id: chatId,
  })
  if (result.duplicate) return '這筆已經記錄過了，沒有重複新增。'
  return formatReceipt({ ledgerName: ledger?.name ?? '帳本', record: parsed.record, members })
}

async function undo({ store, now, chatId, ledgerId, userId }) {
  const since = new Date(now.getTime() - UNDO_WINDOW_MINUTES * 60 * 1000)
  const target = await store.findUndoable({ chatId, ledgerId, userId, since })
  if (!target) return `找不到可撤銷的紀錄。只能撤銷你自己在這個聊天室 ${UNDO_WINDOW_MINUTES} 分鐘內用 LINE 記的最後一筆。`
  await store.deleteTransaction(target.id)
  return `已撤銷：${target.merchant}　NT$ ${Number(target.amount).toLocaleString('zh-TW')}`
}

async function status({ store, ledgerId, members, isGroup, chatId }) {
  const ledger = await store.getLedger(ledgerId)
  const lines = [`目前帳本：${ledger?.name ?? '未知'}`, `成員：${members.map((member) => member.display_name).join('、')}`]
  if (isGroup) {
    const group = await store.getLineGroup(chatId)
    const ids = group?.default_split_among ?? []
    const names = ids.map((id) => members.find((member) => member.user_id === id)?.display_name).filter(Boolean)
    lines.push(`「分帳」預設分給：${names.length ? names.join('、') : '全部成員'}`)
  }
  return lines.join('\n')
}
