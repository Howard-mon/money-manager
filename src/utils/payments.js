import { groupBy, sumBy } from 'lodash-es'

export const PAYMENT_ACCOUNT_KINDS = [
  { label: '信用卡', value: 'credit_card' },
  { label: '房貸', value: 'mortgage' },
  { label: '貸款', value: 'loan' },
  { label: '其他', value: 'other' },
]

export function paymentKindLabel(kind) {
  return PAYMENT_ACCOUNT_KINDS.find((item) => item.value === kind)?.label ?? '未分類'
}

export function paymentSummary(payments) {
  const amount = (payment) => Number(payment.amount) || 0
  return {
    total: sumBy(payments, amount),
    creditCard: sumBy(payments.filter((payment) => !payment.payment_account_id || payment.payment_account?.kind === 'credit_card'), amount),
    fixed: sumBy(payments.filter((payment) => ['mortgage', 'loan'].includes(payment.payment_account?.kind)), amount),
  }
}

export function groupPayments(payments, accounts) {
  const grouped = groupBy(payments, (payment) => payment.payment_account_id ?? 'unclassified')
  const activeGroups = accounts
    .filter((account) => grouped[account.id]?.length)
    .map((account) => ({ account, payments: grouped[account.id], total: sumBy(grouped[account.id], (payment) => Number(payment.amount) || 0) }))

  if (grouped.unclassified?.length) {
    activeGroups.push({
      account: { id: 'unclassified', name: '未分類帳戶', kind: null },
      payments: grouped.unclassified,
      total: sumBy(grouped.unclassified, (payment) => Number(payment.amount) || 0),
    })
  }
  return activeGroups
}
