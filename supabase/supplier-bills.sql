-- Senra Sportswear: supplier bill per club shop round.
-- Safe to run more than once. Run in Supabase → SQL Editor.

-- The real amount you paid the supplier for a club shop round, entered once
-- the order is placed (in £, so price breaks and exchange rate are included).
-- Private: only the admin login can read or change these.
create table if not exists club_supplier_bills (
  club_id text not null,
  round_start text not null,
  amount numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (club_id, round_start)
);
alter table club_supplier_bills enable row level security;
grant select, insert, update, delete on club_supplier_bills to authenticated;
drop policy if exists "Admin can do everything" on club_supplier_bills;
create policy "Admin can do everything" on club_supplier_bills for all to authenticated using (is_admin()) with check (is_admin());

-- The per-item supplier cost table is no longer used (replaced by the bill above).
drop table if exists club_item_costs;
