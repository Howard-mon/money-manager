-- Run once after 003. Existing rows are credit-card spending, which stays the default.
alter table public.transactions
  add column method text not null default 'card' check (method in ('card', 'cash', 'transfer'));
