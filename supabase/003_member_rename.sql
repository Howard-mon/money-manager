-- Run once after 002. Lets a member rename themselves; they still cannot touch anyone else's row.
create policy "Members rename themselves" on public.ledger_members
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
