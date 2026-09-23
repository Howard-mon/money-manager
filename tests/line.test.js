import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { verifySignature } from '../netlify/functions/lib/signature.js'
import { handleEvent, hashCode } from '../netlify/functions/lib/handle-event.js'
import { parseExpense } from '../src/utils/line-message.js'
import { splitShares } from '../src/utils/split.js'

const HOWARD = '11111111-1111-1111-1111-111111111111'
const ELLY = '22222222-2222-2222-2222-222222222222'
const LEDGER = '33333333-3333-3333-3333-333333333333'
const MEMBERS = [{ user_id: HOWARD, display_name: 'Howard' }, { user_id: ELLY, display_name: 'Elly' }]
const TODAY = new Date('2026-10-05T12:00:00+08:00')

const parse = (text, extra = {}) =>
  parseExpense(text, { members: MEMBERS, defaultSplit: [HOWARD, ELLY], senderUserId: HOWARD, today: TODAY, ...extra })

function fakeStore(overrides = {}) {
  const state = {
    lineUsers: { Uhoward: { line_user_id: 'Uhoward', user_id: HOWARD, default_ledger_id: LEDGER } },
    groups: { Cgroup: { ledger_id: LEDGER, default_split_among: [HOWARD, ELLY] } },
    transactions: [],
    codes: {},
    deleted: [],
    ...overrides,
  }
  const store = {
    state,
    getLineUser: async (id) => state.lineUsers[id] ?? null,
    getLineGroup: async (id) => state.groups[id] ?? null,
    getLedger: async () => ({ id: LEDGER, name: '家庭帳本', owner_id: HOWARD }),
    getMembers: async () => MEMBERS,
    consumeCode: async (hash) => {
      const entry = state.codes[hash]
      if (!entry || entry.used) return null
      entry.used = true
      return entry
    },
    linkUser: async (link) => { state.lineUsers[link.lineUserId] = { line_user_id: link.lineUserId, user_id: link.userId, default_ledger_id: link.defaultLedgerId } },
    linkGroup: async (link) => { state.groups[link.lineGroupId] = { ledger_id: link.ledgerId, default_split_among: link.defaultSplitAmong } },
    insertTransaction: async (record) => {
      if (record.line_event_id && state.transactions.some((row) => row.line_event_id === record.line_event_id)) return { duplicate: true }
      const row = { id: `tx${state.transactions.length + 1}`, created_at: TODAY.toISOString(), ...record }
      state.transactions.push(row)
      return { id: row.id }
    },
    findUndoable: async ({ chatId, ledgerId, userId }) =>
      [...state.transactions].reverse().find((row) =>
        row.line_chat_id === chatId && row.ledger_id === ledgerId && row.user_id === userId && row.source === 'line') ?? null,
    deleteTransaction: async (id) => {
      state.deleted.push(id)
      state.transactions = state.transactions.filter((row) => row.id !== id)
    },
  }
  return store
}

const message = (text, extra = {}) => ({
  type: 'message',
  webhookEventId: extra.webhookEventId ?? `evt-${Math.random()}`,
  replyToken: 'token',
  source: extra.source ?? { type: 'user', userId: 'Uhoward' },
  message: { type: 'text', text, ...(extra.mention ? { mention: extra.mention } : {}) },
})

test('LINE 簽章：正確通過，被竄改或偽造的簽章不通過', () => {
  const body = '{"events":[]}'
  const secret = 'channel-secret'
  const signature = createHmac('sha256', secret).update(body, 'utf8').digest('base64')
  assert.equal(verifySignature(body, signature, secret), true)
  assert.equal(verifySignature(body + ' ', signature, secret), false)
  assert.equal(verifySignature(body, signature, 'wrong-secret'), false)
  assert.equal(verifySignature(body, 'bm90LWEtc2lnbmF0dXJl', secret), false)
  assert.equal(verifySignature(body, null, secret), false)
})

test('解析：逗號分隔、全形符號、元與分帳', () => {
  const { record } = parse(' 今天，吃晚餐－火鍋，1,215元，分帳，現金')
  assert.equal(record.merchant, '吃晚餐-火鍋')
  assert.equal(record.amount, 1215)
  assert.equal(record.method, 'cash')
  assert.equal(record.spent_at, '2026-10-05')
  assert.equal(record.billing_month, '2026-10-01')
  assert.deepEqual(record.split_among, [HOWARD, ELLY])
  assert.equal(record.source, 'line')
})

test('解析：空格分隔、昨天、預設信用卡與自動分類', () => {
  const { record } = parse(' 昨天 Uber 245 信用卡')
  assert.equal(record.spent_at, '2026-10-04')
  assert.equal(record.amount, 245)
  assert.equal(record.method, 'card')
  assert.deepEqual(record.split_among, [HOWARD])
  const cash = parse(' 今天 全聯 680 現金 分帳').record
  assert.equal(cash.category, '生活')
  assert.equal(cash.method, 'cash')
})

test('解析：跨月日期與指定分類、卡片', () => {
  const { record } = parse(' 9/20 Netflix 399 分類:訂閱')
  assert.equal(record.spent_at, '2026-09-20')
  assert.equal(record.billing_month, '2026-09-01')
  assert.equal(record.category, '訂閱')
  const tagged = parse(' 好市多 3200 卡片:台新 分帳').record
  assert.equal(tagged.card_name, '台新')
  assert.equal(tagged.category, '其他')
  assert.equal(parse(' 早餐 85 #餐飲').record.category, '餐飲')
})

test('解析：指定付款人與指定成員平分，餘數加總仍等於原金額', () => {
  const { record } = parse(' 火鍋 1215 Elly付 Howard Elly平分')
  assert.equal(record.paid_by, ELLY)
  assert.deepEqual(record.split_among, [HOWARD, ELLY])
  const shares = splitShares(record)
  assert.deepEqual(Object.values(shares), [608, 607])
  assert.equal(Object.values(shares).reduce((sum, value) => sum + value, 0), 1215)
})

test('解析：找不到成員或缺少項目、金額時拒絕寫入', () => {
  assert.match(parse(' 火鍋 300 Bob付').error, /找不到成員「Bob」/)
  assert.match(parse(' 火鍋 300 Bob Howard平分').error, /找不到成員「Bob」/)
  assert.match(parse(' 300').error, /項目/)
  assert.match(parse(' 火鍋').error, /金額/)
  assert.match(parse(' 火鍋 0').error, /金額/)
  const dupes = [{ user_id: HOWARD, display_name: '我' }, { user_id: ELLY, display_name: '我' }]
  assert.match(parse(' 火鍋 300 我付', { members: dupes }).error, /多位成員/)
})

test('未綁定的 LINE 使用者無法記帳', async () => {
  const store = fakeStore({ lineUsers: {} })
  const text = await handleEvent(message('記帳 午餐 120'), { store, now: TODAY })
  assert.match(text, /還沒連結帳本/)
  assert.equal(store.state.transactions.length, 0)
})

test('群組未綁定帳本時不寫入，且忽略一般聊天', async () => {
  const store = fakeStore({ groups: {} })
  const source = { type: 'group', groupId: 'Cgroup', userId: 'Uhoward' }
  assert.match(await handleEvent(message('記帳 午餐 120', { source }), { store, now: TODAY }), /還沒綁定帳本/)
  assert.equal(await handleEvent(message('今天天氣不錯', { source }), { store, now: TODAY }), null)
  assert.equal(store.state.transactions.length, 0)
})

test('群組記帳會套用群組預設分攤成員', async () => {
  const store = fakeStore()
  const source = { type: 'group', groupId: 'Cgroup', userId: 'Uhoward' }
  const text = await handleEvent(message('記帳 火鍋 1215 分帳', { source }), { store, now: TODAY })
  assert.match(text, /家庭帳本/)
  assert.match(text, /Howard 608、Elly 607/)
  const [row] = store.state.transactions
  assert.deepEqual(row.split_among, [HOWARD, ELLY])
  assert.equal(row.line_chat_id, 'Cgroup')
  assert.equal(row.source, 'line')
})

test('同一個 webhookEventId 重送不會記成兩筆', async () => {
  const store = fakeStore()
  const event = message('記帳 午餐 120', { webhookEventId: 'evt-1' })
  await handleEvent(event, { store, now: TODAY })
  const again = await handleEvent(event, { store, now: TODAY })
  assert.equal(store.state.transactions.length, 1)
  assert.match(again, /已經記錄過/)
})

test('撤銷只刪掉自己在同一聊天室最近的一筆 LINE 記帳', async () => {
  const store = fakeStore()
  store.state.transactions.push(
    { id: 'other-member', ledger_id: LEDGER, user_id: ELLY, line_chat_id: 'Uhoward', source: 'line', merchant: 'Elly 的消費', amount: 50 },
    { id: 'from-website', ledger_id: LEDGER, user_id: HOWARD, line_chat_id: null, source: 'manual', merchant: '網站建立', amount: 60 },
  )
  await handleEvent(message('記帳 午餐 120'), { store, now: TODAY })
  const undone = await handleEvent(message('撤銷'), { store, now: TODAY })
  assert.match(undone, /已撤銷：午餐/)
  assert.deepEqual(store.state.transactions.map((row) => row.id), ['other-member', 'from-website'])
  assert.match(await handleEvent(message('撤銷'), { store, now: TODAY }), /找不到可撤銷的紀錄/)
})

test('綁定碼：一次性使用，個人碼不能在群組使用', async () => {
  const store = fakeStore({ lineUsers: {} })
  store.state.codes[hashCode('ABCD1234')] = { kind: 'user', issued_by: HOWARD, ledger_id: LEDGER, default_split_among: [] }
  const groupSource = { type: 'group', groupId: 'Cnew', userId: 'Uhoward' }
  assert.match(await handleEvent(message('綁定 ABCD1234', { source: groupSource }), { store, now: TODAY }), /個人綁定碼/)

  store.state.codes[hashCode('ABCD1234')].used = false
  assert.match(await handleEvent(message('ABCD1234'), { store, now: TODAY }), /綁定完成/)
  assert.equal(store.state.lineUsers.Uhoward.user_id, HOWARD)
  assert.match(await handleEvent(message('ABCD1234'), { store, now: TODAY }), /無效或已過期/)
})

test('群組綁定碼只能由發碼的帳本建立者在群組使用', async () => {
  const store = fakeStore()
  store.state.codes[hashCode('EFEF5678')] = { kind: 'group', issued_by: HOWARD, ledger_id: LEDGER, default_split_among: [HOWARD, ELLY] }
  const source = { type: 'group', groupId: 'Cnew', userId: 'Uelly' }
  store.state.lineUsers.Uelly = { line_user_id: 'Uelly', user_id: ELLY, default_ledger_id: LEDGER }
  assert.match(await handleEvent(message('綁定 EFEF5678', { source }), { store, now: TODAY }), /產生綁定碼的本人/)

  store.state.codes[hashCode('EFEF5678')].used = false
  const ok = await handleEvent(message('綁定 EFEF5678', { source: { type: 'group', groupId: 'Cnew', userId: 'Uhoward' } }), { store, now: TODAY })
  assert.match(ok, /已綁定帳本「家庭帳本」/)
  assert.deepEqual(store.state.groups.Cnew.default_split_among, [HOWARD, ELLY])
})

test('提及機器人的訊息會被正確解析，說明與目前帳本可用', async () => {
  const store = fakeStore()
  const source = { type: 'group', groupId: 'Cgroup', userId: 'Uhoward' }
  const mention = { mentionees: [{ index: 0, length: 4 }] }
  const text = await handleEvent(message('@bot 記帳 咖啡 85', { source, mention }), { store, now: TODAY })
  assert.match(text, /咖啡/)
  assert.match(await handleEvent(message('記帳說明'), { store, now: TODAY }), /記帳格式/)
  assert.match(await handleEvent(message('目前帳本', { source }), { store, now: TODAY }), /「分帳」預設分給：Howard、Elly/)
})

test('Webhook 進入點：空事件回 200，簽章錯誤回 401，非 POST 回 405', async () => {
  process.env.LINE_CHANNEL_SECRET = 'channel-secret'
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'access-token'
  const { default: webhook } = await import('../netlify/functions/line-webhook.js')
  const body = JSON.stringify({ destination: 'U0', events: [] })
  const signature = createHmac('sha256', 'channel-secret').update(body, 'utf8').digest('base64')
  const post = (payload, header) =>
    webhook(new Request('https://example.test/api/line/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(header ? { 'x-line-signature': header } : {}) },
      body: payload,
    }))

  assert.equal((await post(body, signature)).status, 200)
  assert.equal((await post(body, 'd3Jvbmc=')).status, 401)
  assert.equal((await post(body, null)).status, 401)
  assert.equal((await post('{"events":[]} tampered', signature)).status, 401)
  assert.equal((await webhook(new Request('https://example.test/api/line/webhook'))).status, 405)
})

test('「下期」會把消費記到下一期帳單，跨年也正確', () => {
  assert.equal(parse(' 今天 好市多 3200 下期').record.billing_month, '2026-11-01')
  assert.equal(parse(' 今天 好市多 3200').record.billing_month, '2026-10-01')
  assert.equal(parse(' 12/30 尾牙 2000 下期', { today: new Date('2026-12-30T12:00:00+08:00') }).record.billing_month, '2027-01-01')
})
