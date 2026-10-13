-- Run once after 006. Lets one expense be split with people who are not in the ledger
-- (e.g. 9 people share the cost, only 2 of them keep this ledger).
alter table public.transactions
  add column outside_count smallint not null default 0 check (outside_count between 0 and 50);

notify pgrst, 'reload schema';
