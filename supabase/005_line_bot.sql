-- Run once after 004. Adds LINE bot linking, group ledger binding and LINE provenance on transactions.
-- The webhook runs with the service key (bypasses RLS), so it re-checks sender/ledger/membership in JavaScript.
begin;

-- One LINE account per user. The raw LINE id is only ever read by the webhook, never exposed to the browser.
create table public.line_users (
  line_user_id text primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  default_ledger_id uuid references public.ledgers(id) on delete set null,
  linked_at timestamptz not null default now()
);

create table public.line_groups (
  line_group_id text primary key,
  ledger_id uuid not null references public.ledgers(id) on delete cascade,
  default_split_among uuid[] not null default '{}',
  linked_by uuid not null references auth.users(id) on delete cascade,
  linked_at timestamptz not null default now()
);
create index line_groups_ledger on public.line_groups (ledger_id);

-- Single-use codes: only the SHA-256 hash is stored, and no role but the service key can read them.
create table public.line_link_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  kind text not null check (kind in ('user', 'group')),
  issued_by uuid not null references auth.users(id) on delete cascade,
  ledger_id uuid references public.ledgers(id) on delete cascade,
  default_split_among uuid[] not null default '{}',
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint group_code_needs_ledger check (kind = 'user' or ledger_id is not null)
);
create index line_link_codes_open on public.line_link_codes (expires_at) where used_at is null;

alter table public.transactions
  add column line_event_id text,
  add column line_chat_id text;

-- A redelivered webhook event must never create a second transaction.
create unique index transactions_line_event on public.transactions (line_event_id) where line_event_id is not null;
-- Undo looks up the sender's own latest LINE row in one chat.
create index transactions_line_undo on public.transactions (line_chat_id, user_id, created_at desc) where source = 'line';

alter table public.transactions drop constraint transactions_source_check;
alter table public.transactions add constraint transactions_source_check
  check (source in ('manual', 'paste', 'line'));

alter table public.line_users enable row level security;
alter table public.line_groups enable row level security;
alter table public.line_link_codes enable row level security;

create policy "Owners read their LINE link" on public.line_users
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Owners unlink their LINE" on public.line_users
  for delete to authenticated using (user_id = (select auth.uid()));
create policy "Members read group links" on public.line_groups
  for select to authenticated using (public.is_ledger_member(ledger_id));
create policy "Ledger owners unlink groups" on public.line_groups
  for delete to authenticated using (
    exists (select 1 from public.ledgers l where l.id = ledger_id and l.owner_id = (select auth.uid()))
  );
-- line_link_codes deliberately has no policy: codes are written by the RPC below and read only by the webhook.

-- Returns the plain code once; only its hash is stored. Issuing a new code closes the previous unused one.
create function public.create_line_link_code(link_kind text, target_ledger uuid default null, members uuid[] default '{}')
returns table (code text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  raw_code text;
  valid_until timestamptz := now() + interval '15 minutes';
begin
  if auth.uid() is null then raise exception '請先登入'; end if;
  if link_kind not in ('user', 'group') then raise exception '綁定碼類型無效'; end if;

  if link_kind = 'group' then
    if target_ledger is null then raise exception '請選擇帳本'; end if;
    if not exists (select 1 from public.ledgers where id = target_ledger and owner_id = auth.uid()) then
      raise exception '只有帳本建立者可以綁定 LINE 群組';
    end if;
    if not public.ledger_has_members(target_ledger, coalesce(members, '{}')) then
      raise exception '預設分攤成員必須都是這本帳本的成員';
    end if;
  elsif target_ledger is not null and not public.is_ledger_member(target_ledger) then
    raise exception '你不是這本帳本的成員';
  end if;

  update public.line_link_codes set used_at = now()
  where issued_by = auth.uid() and kind = link_kind and used_at is null;

  raw_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.line_link_codes (code_hash, kind, issued_by, ledger_id, default_split_among, expires_at)
  values (encode(extensions.digest(raw_code, 'sha256'), 'hex'), link_kind, auth.uid(), target_ledger,
          coalesce(members, '{}'), valid_until);

  return query select raw_code, valid_until;
end $$;

revoke execute on function public.create_line_link_code(text, uuid, uuid[]) from public, anon;

commit;
