import test from 'node:test'
import assert from 'node:assert/strict'
import { groupPayments, paymentSummary } from '../src/utils/payments.js'

const accounts = [
  { id: 'card', name: '銀行信用卡', kind: 'credit_card' },
  { id: 'home', name: '房貸', kind: 'mortgage' },
]

test('payment summary keeps repayments outside spending and separates fixed burden', () => {
  const summary = paymentSummary([
    { amount: 3000, payment_account_id: 'card', payment_account: accounts[0] },
    { amount: 12000, payment_account_id: 'home', payment_account: accounts[1] },
    { amount: 500, payment_account_id: null, payment_account: null },
  ])

  assert.deepEqual(summary, { total: 15500, creditCard: 3500, fixed: 12000 })
})

test('legacy payments remain visible under an unclassified account', () => {
  const groups = groupPayments([
    { id: 'a', amount: 1000, payment_account_id: 'card' },
    { id: 'b', amount: 500, payment_account_id: null },
  ], accounts)

  assert.deepEqual(groups.map((group) => [group.account.name, group.total]), [
    ['銀行信用卡', 1000],
    ['未分類帳戶', 500],
  ])
})
