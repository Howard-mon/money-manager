-- Run once after schema.sql. Adds shareable ledgers, who-paid / split-among fields and month settlements.
-- Every existing user gets a private "我的帳本"; their existing records move into it.
begin;

create table public.ledgers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 40),
  owner_id uuid not null references auth.users(id) on delete cascade,
  invite_code text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);

create table public.ledger_members (
  ledger_id uuid not null references public.ledgers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 30),
  joined_at timestamptz not null default now(),
  primary key (ledger_id, user_id)
);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references public.ledgers(id) on delete cascade,
  billing_month date not null check (billing_month = date_trunc('month', billing_month)::date),
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

-- True when every id in people is a distinct member of the ledger; duplicates or strangers fail.
create function public.ledger_has_members(target uuid, people uuid[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select count(*) = cardinality(people)
  from public.ledger_members where ledger_id = target and user_id = any(people)
$$;

create function public.is_ledger_member(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.ledger_has_members(target, array[auth.uid()])
$$;

create function public.create_ledger(ledger_name text, member_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception '請先登入'; end if;
  insert into public.ledgers (name, owner_id) values (trim(ledger_name), auth.uid()) returning id into new_id;
  insert into public.ledger_members (ledger_id, user_id, display_name) values (new_id, auth.uid(), trim(member_name));
  return new_id;
end $$;

create function public.join_ledger(code text, member_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  if auth.uid() is null then raise exception '請先登入'; end if;
  select id into target from public.ledgers where invite_code = code;
  if target is null then raise exception '邀請連結無效'; end if;
  insert into public.ledger_members (ledger_id, user_id, display_name)
  values (target, auth.uid(), trim(member_name)) on conflict (ledger_id, user_id) do nothing;
  return target;
end $$;

revoke execute on function public.ledger_has_members(uuid, uuid[]), public.is_ledger_member(uuid),
  public.create_ledger(text, text), public.join_ledger(text, text) from public, anon;

-- Backfill: one private ledger per existing user, then attach their records to it.
with created as (
  insert into public.ledgers (name, owner_id) select '我的帳本', id from auth.users returning id, owner_id
)
insert into public.ledger_members (ledger_id, user_id, display_name)
select c.id, u.id, coalesce(nullif(left(split_part(u.email, '@', 1), 30), ''), '我')
from created c join auth.users u on u.id = c.owner_id;

alter table public.transactions
  add column ledger_id uuid references public.ledgers(id) on delete cascade,
  add column paid_by uuid references auth.users(id) on delete cascade,
  add column split_among uuid[];
alter table public.payments add column ledger_id uuid references public.ledgers(id) on delete cascade;

update public.transactions t set ledger_id = l.id, paid_by = t.user_id, split_among = array[t.user_id]
from public.ledgers l where l.owner_id = t.user_id;
update public.payments p set ledger_id = l.id from public.ledgers l where l.owner_id = p.user_id;

alter table public.transactions
  alter column ledger_id set not null,
  alter column paid_by set not null,
  alter column paid_by set default auth.uid(),
  alter column split_among set not null,
  alter column split_among set default array[auth.uid()],
  add constraint split_not_empty check (cardinality(split_among) > 0);
alter table public.payments alter column ledger_id set not null;

drop index if exists public.transactions_owner_month;
drop index if exists public.payments_owner_month;
create index transactions_ledger_month on public.transactions (ledger_id, billing_month, spent_at desc);
create index payments_ledger_month on public.payments (ledger_id, billing_month, paid_at desc);
create index settlements_ledger_month on public.settlements (ledger_id, billing_month);

alter table public.ledgers enable row level security;
alter table public.ledger_members enable row level security;
alter table public.settlements enable row level security;

-- Ledgers and memberships are only written through create_ledger / join_ledger.
create policy "Members read ledgers" on public.ledgers
  for select to authenticated using (public.is_ledger_member(id));
create policy "Members read members" on public.ledger_members
  for select to authenticated using (public.is_ledger_member(ledger_id));

drop policy "Owner manages transactions" on public.transactions;
drop policy "Owner manages payments" on public.payments;

create policy "Members manage transactions" on public.transactions
  for all to authenticated using (public.is_ledger_member(ledger_id))
  with check (
    public.is_ledger_member(ledger_id) and user_id = (select auth.uid())
    and public.ledger_has_members(ledger_id, array[paid_by])
    and public.ledger_has_members(ledger_id, split_among)
  );
create policy "Members manage payments" on public.payments
  for all to authenticated using (public.is_ledger_member(ledger_id))
  with check (public.is_ledger_member(ledger_id) and user_id = (select auth.uid()));
create policy "Members manage settlements" on public.settlements
  for all to authenticated using (public.is_ledger_member(ledger_id))
  with check (public.is_ledger_member(ledger_id) and public.ledger_has_members(ledger_id, array[from_user, to_user]));

commit;
