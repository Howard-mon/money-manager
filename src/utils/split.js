// What each ledger member owes for one transaction, in whole NT dollars.
// outside_count adds shares for people who are not in the ledger: the cost is divided by
// members + outsiders, and the members' shares no longer add up to the full amount.
export function splitShares(tx) {
  const total = Math.round(Number(tx.amount))
  const outside = Math.max(0, Math.round(Number(tx.outside_count) || 0))
  const count = tx.split_among.length + outside
  const base = Math.floor(total / count)
  const extra = total - base * count
  return Object.fromEntries(tx.split_among.map((id, index) => [id, base + (index < extra ? 1 : 0)]))
}

// The part the payer fronted for non-members, to be collected outside this ledger.
export function outsideShare(tx) {
  const shares = splitShares(tx)
  return Math.round(Number(tx.amount)) - Object.values(shares).reduce((sum, value) => sum + value, 0)
}

// net > 0: the member should receive money; net < 0: the member should pay.
export function splitSummary(transactions, settlements) {
  const people = {}
  const person = (id) => (people[id] ??= { paid: 0, share: 0, net: 0, outside: 0 })
  const round = (value) => Math.round(Number(value))

  for (const tx of transactions) {
    person(tx.paid_by).paid += round(tx.amount)
    person(tx.paid_by).outside += outsideShare(tx)
    const shares = splitShares(tx)
    for (const id in shares) person(id).share += shares[id]
  }
  for (const id in people) people[id].net = people[id].paid - people[id].share
  for (const transfer of settlements) {
    person(transfer.from_user).net += round(transfer.amount)
    person(transfer.to_user).net -= round(transfer.amount)
  }

  // ponytail: greedy largest-debtor-to-largest-creditor, at most n-1 transfers; fine for a family-sized ledger.
  const debtors = Object.entries(people).filter(([, p]) => p.net < 0).map(([id, p]) => [id, -p.net]).sort((a, b) => b[1] - a[1])
  const creditors = Object.entries(people).filter(([, p]) => p.net > 0).map(([id, p]) => [id, p.net]).sort((a, b) => b[1] - a[1])
  const transfers = []
  for (let i = 0, j = 0; i < debtors.length && j < creditors.length;) {
    const amount = Math.min(debtors[i][1], creditors[j][1])
    transfers.push({ from: debtors[i][0], to: creditors[j][0], amount })
    if (!(debtors[i][1] -= amount)) i++
    if (!(creditors[j][1] -= amount)) j++
  }

  return { people, transfers }
}
