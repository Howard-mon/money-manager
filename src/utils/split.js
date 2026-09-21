// Works in cents so every split adds back up to the original amount.
// net > 0: the member should receive money; net < 0: the member should pay.
export function splitSummary(transactions, settlements) {
  const people = {}
  const person = (id) => (people[id] ??= { paid: 0, share: 0, net: 0 })
  const cents = (value) => Math.round(Number(value) * 100)

  for (const tx of transactions) {
    const total = cents(tx.amount)
    const count = tx.split_among.length
    const base = Math.floor(total / count)
    person(tx.paid_by).paid += total
    // The first (total - base * count) members absorb the leftover cents.
    tx.split_among.forEach((id, index) => { person(id).share += base + (index < total - base * count ? 1 : 0) })
  }
  for (const id in people) people[id].net = people[id].paid - people[id].share
  for (const transfer of settlements) {
    person(transfer.from_user).net += cents(transfer.amount)
    person(transfer.to_user).net -= cents(transfer.amount)
  }

  // ponytail: greedy largest-debtor-to-largest-creditor, at most n-1 transfers; fine for a family-sized ledger.
  const debtors = Object.entries(people).filter(([, p]) => p.net < 0).map(([id, p]) => [id, -p.net]).sort((a, b) => b[1] - a[1])
  const creditors = Object.entries(people).filter(([, p]) => p.net > 0).map(([id, p]) => [id, p.net]).sort((a, b) => b[1] - a[1])
  const transfers = []
  for (let i = 0, j = 0; i < debtors.length && j < creditors.length;) {
    const amount = Math.min(debtors[i][1], creditors[j][1])
    transfers.push({ from: debtors[i][0], to: creditors[j][0], amount: amount / 100 })
    if (!(debtors[i][1] -= amount)) i++
    if (!(creditors[j][1] -= amount)) j++
  }

  for (const id in people) for (const key in people[id]) people[id][key] /= 100
  return { people, transfers }
}
