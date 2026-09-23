import { createClient } from '@supabase/supabase-js'

// Runs with the service key, so it bypasses RLS: every caller in handle-event.js checks
// the sender, the ledger and the membership itself before anything is written.
export function createStore(url = process.env.SUPABASE_URL, secret = process.env.SUPABASE_SECRET_KEY) {
  if (!url || !secret) throw new Error('missing Supabase configuration')
  const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
  const one = async (query) => {
    const { data, error } = await query.maybeSingle()
    if (error) throw error
    return data
  }

  return {
    getLineUser: (lineUserId) =>
      one(db.from('line_users').select('line_user_id, user_id, default_ledger_id').eq('line_user_id', lineUserId)),

    getLineGroup: (lineGroupId) =>
      one(db.from('line_groups').select('ledger_id, default_split_among').eq('line_group_id', lineGroupId)),

    getLedger: (ledgerId) => one(db.from('ledgers').select('id, name, owner_id').eq('id', ledgerId)),

    async getMembers(ledgerId) {
      const { data, error } = await db.from('ledger_members').select('user_id, display_name').eq('ledger_id', ledgerId).order('joined_at')
      if (error) throw error
      return data ?? []
    },

    // One atomic update: a code can only ever be claimed once, even on concurrent deliveries.
    consumeCode: (codeHash, now) =>
      one(db.from('line_link_codes').update({ used_at: now.toISOString() })
        .eq('code_hash', codeHash).is('used_at', null).gt('expires_at', now.toISOString())
        .select('kind, issued_by, ledger_id, default_split_among')),

    async linkUser({ lineUserId, userId, defaultLedgerId }) {
      const { error } = await db.from('line_users')
        .upsert({ line_user_id: lineUserId, user_id: userId, default_ledger_id: defaultLedgerId }, { onConflict: 'user_id' })
      if (error) throw error
    },

    async linkGroup({ lineGroupId, ledgerId, defaultSplitAmong, linkedBy }) {
      const { error } = await db.from('line_groups')
        .upsert({ line_group_id: lineGroupId, ledger_id: ledgerId, default_split_among: defaultSplitAmong, linked_by: linkedBy })
      if (error) throw error
    },

    async insertTransaction(record) {
      const { data, error } = await db.from('transactions').insert(record).select('id').maybeSingle()
      if (error?.code === '23505') return { duplicate: true } // line_event_id already recorded
      if (error) throw error
      return { id: data?.id }
    },

    findUndoable: ({ chatId, ledgerId, userId, since }) =>
      one(db.from('transactions').select('id, merchant, amount')
        .eq('line_chat_id', chatId).eq('ledger_id', ledgerId).eq('user_id', userId).eq('source', 'line')
        .gte('created_at', since.toISOString()).order('created_at', { ascending: false }).limit(1)),

    async deleteTransaction(id) {
      const { error } = await db.from('transactions').delete().eq('id', id)
      if (error) throw error
    },
  }
}
