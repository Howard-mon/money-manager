-- Run once in the Supabase SQL Editor. Every record is private to its owner.
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  spent_at date not null,
  billing_month date not null check (billing_month = date_trunc('month', billing_month)::date),
  merchant text not null check (length(trim(merchant)) between 1 and 120),
  amount numeric(12, 2) not null check (amount <> 0),
  category text not null default '其他',
  card_name text,
  note text,
  source text not null default 'manual' check (source in ('manual', 'paste')),
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  paid_at date not null,
  billing_month date not null check (billing_month = date_trunc('month', billing_month)::date),
  amount numeric(12, 2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create index if not exists transactions_owner_month on public.transactions (user_id, billing_month, spent_at desc);
create index if not exists payments_owner_month on public.payments (user_id, billing_month, paid_at desc);

alter table public.transactions enable row level security;
alter table public.payments enable row level security;

create policy "Owner manages transactions" on public.transactions
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Owner manages payments" on public.payments
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('statements', 'statements', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf'];

create policy "Owner reads statements" on storage.objects
  for select to authenticated using (
    bucket_id = 'statements' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "Owner uploads statements" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'statements' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
