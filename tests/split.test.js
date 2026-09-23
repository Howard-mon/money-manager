import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitShares, splitSummary } from '../src/utils/split.js'

test('兩人平分餐費，未付的一方要轉帳給付款人', () => {
  const { people, transfers } = splitSummary([{ amount: 600, paid_by: 'mom', split_among: ['me', 'mom'] }], [])
  assert.deepEqual(people.mom, { paid: 600, share: 300, net: 300 })
  assert.deepEqual(transfers, [{ from: 'me', to: 'mom', amount: 300 }])
})

test('除不盡的零頭不會憑空消失，退款也照比例分回', () => {
  const { people, transfers } = splitSummary([
    { amount: 100, paid_by: 'a', split_among: ['a', 'b', 'c'] },
    { amount: -10, paid_by: 'a', split_among: ['a', 'b', 'c'] },
  ], [])
  assert.equal(people.a.share + people.b.share + people.c.share, 90)
  assert.equal(Math.round(transfers.reduce((sum, t) => sum + t.amount, 0) * 100), Math.round(people.a.net * 100))
})

test('三人互相代墊後合併成最少轉帳，已記錄的月結會抵銷', () => {
  const rows = [
    { amount: 300, paid_by: 'a', split_among: ['a', 'b', 'c'] },
    { amount: 90, paid_by: 'b', split_among: ['a', 'b', 'c'] },
  ]
  const { transfers } = splitSummary(rows, [])
  assert.deepEqual(transfers, [{ from: 'c', to: 'a', amount: 130 }, { from: 'b', to: 'a', amount: 40 }])
  const settlements = transfers.map((t) => ({ from_user: t.from, to_user: t.to, amount: t.amount }))
  assert.deepEqual(splitSummary(rows, settlements).transfers, [])
})

test('單筆分攤金額與總計用同一套進位，零頭落在前面的成員', () => {
  const tx = { amount: 100, paid_by: 'a', split_among: ['a', 'b', 'c'] }
  assert.deepEqual(splitShares(tx), { a: 33.34, b: 33.33, c: 33.33 })
  const { people } = splitSummary([tx], [])
  assert.equal(people.a.share, splitShares(tx).a)
})

test('成員明細逐筆加總等於分帳頁的淨額', () => {
  const rows = [
    { amount: 100, paid_by: 'a', split_among: ['a', 'b', 'c'] },
    { amount: 251, paid_by: 'b', split_among: ['a', 'b'] },
    { amount: -30, paid_by: 'a', split_among: ['a', 'b', 'c'] },
  ]
  const { people } = splitSummary(rows, [])
  for (const id of ['a', 'b', 'c']) {
    const lines = rows.filter((tx) => tx.paid_by === id || tx.split_among.includes(id))
      .map((tx) => (tx.paid_by === id ? Number(tx.amount) : 0) - (splitShares(tx)[id] ?? 0))
    const sum = lines.reduce((total, value) => total + value, 0)
    assert.equal(Math.round(sum * 100), Math.round(people[id].net * 100), `成員 ${id}`)
  }
})
