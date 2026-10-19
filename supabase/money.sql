-- Senra Sportswear: money tracking for club shops.
-- Safe to run more than once. Run in Supabase → SQL Editor.

-- Every order now remembers exactly what the customer paid, so changing a
-- price later never changes past orders, totals or refunds.
alter table orders add column if not exists unit_price numeric;
alter table orders add column if not exists stripe_fee numeric;
alter table orders add column if not exists stripe_payment_intent text;
alter table orders add column if not exists refunded_amount numeric;
alter table orders add column if not exists refunded_at timestamptz;

-- Orders placed before this change: fill in the price from the item's
-- current price (the best record we have for those).
update orders o set unit_price = ci.price
  from club_items ci
  where o.unit_price is null and o.item_id is not null and o.item_id::text = ci.id::text;
update orders o set unit_price = p.price
  from products p
  where o.unit_price is null and o.product_id is not null and o.product_id::text = p.id::text;

-- What each club shop item costs you from the supplier.
-- Private: only the admin login can read or change these, never customers.
create table if not exists club_item_costs (
  item_id text primary key,
  cost numeric not null default 0
);
alter table club_item_costs enable row level security;
grant select, insert, update, delete on club_item_costs to authenticated;
drop policy if exists "Admin can do everything" on club_item_costs;
create policy "Admin can do everything" on club_item_costs for all to authenticated using (is_admin()) with check (is_admin());
