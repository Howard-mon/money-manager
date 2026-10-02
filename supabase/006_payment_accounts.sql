-- Run once after 005_line_bot.sql. Adds ledger-scoped payment accounts without changing old payments.
begin;

create table public.payment_accounts (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references public.ledgers(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 50),
  kind text not null check (kind in ('credit_card', 'mortgage', 'loan', 'other')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index payment_accounts_ledger_name on public.payment_accounts (ledger_id, lower(name));
create index payment_accounts_ledger on public.payment_accounts (ledger_id, active, created_at);

alter table public.payments
  add column payment_account_id uuid references public.payment_accounts(id) on delete set null;
create index payments_account_month on public.payments (payment_account_id, billing_month, paid_at desc);

alter table public.payment_accounts enable row level security;

create policy "Members manage payment accounts" on public.payment_accounts
  for all to authenticated using (public.is_ledger_member(ledger_id))
  with check (public.is_ledger_member(ledger_id));

drop policy "Members manage payments" on public.payments;
create policy "Members manage payments" on public.payments
  for all to authenticated using (public.is_ledger_member(ledger_id))
  with check (
    public.is_ledger_member(ledger_id)
    and user_id = (select auth.uid())
    and (
      payment_account_id is null
      or exists (
        select 1 from public.payment_accounts account
        where account.id = payment_account_id and account.ledger_id = payments.ledger_id
      )
    )
  );

commit;

-- Make the new table and foreign key visible to Supabase REST immediately.
notify pgrst, 'reload schema';
