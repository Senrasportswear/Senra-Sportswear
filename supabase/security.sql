-- Senra Sportswear: database security rules.
-- Safe to run more than once. Run in Supabase → SQL Editor.

-- Banner tables (in case they haven't been created yet)
create table if not exists banner_slides (
  id uuid primary key default gen_random_uuid(),
  image_url text not null,
  word_color text not null default '#1428F5',
  position int not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists site_settings (key text primary key, value text);

-- Lets the server mark a paid basket as recorded, so an order is never saved twice
alter table baskets add column if not exists recorded boolean not null default false;

-- Only the shop owner's login counts as admin
create or replace function is_admin() returns boolean
language sql stable as $$
  select coalesce(lower(auth.jwt() ->> 'email') = 'info@senrasportswear.co.uk', false)
$$;

-- Club shop progress bars: totals per item only, no customer details
create or replace function club_item_counts(p_club text, p_since text default null)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('item_id', item_id, 'qty', q)), '[]'::json)
  from (
    select item_id, sum(qty) as q from orders
    where club_id::text = p_club
      and not coalesce(refunded, false)
      and (p_since is null or created_at >= p_since::timestamptz)
    group by item_id
  ) t
$$;
grant execute on function club_item_counts(text, text) to anon, authenticated;

-- Remove all old rules, then add the new ones
do $$ declare r record; begin
  for r in select policyname, schemaname, tablename from pg_policies
    where (schemaname = 'public' and tablename in ('products','clubs','club_items','orders','baskets','requests','size_guides','gallery','banner_slides','site_settings'))
       or (schemaname = 'storage' and tablename = 'objects')
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array['products','clubs','club_items','orders','baskets','requests','size_guides','gallery','banner_slides','site_settings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('grant select, insert, update, delete on %I to anon, authenticated', t);
    execute format('create policy "Admin can do everything" on %I for all to authenticated using (is_admin()) with check (is_admin())', t);
  end loop;
  -- What the public can see
  foreach t in array array['products','clubs','club_items','size_guides','gallery','banner_slides','site_settings'] loop
    execute format('create policy "Anyone can view" on %I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

-- The public "request a club shop" form
create policy "Anyone can send a request" on requests for insert to anon, authenticated with check (true);

-- Photos: anyone can view, only admin can upload or remove
create policy "Anyone can view images" on storage.objects for select to anon, authenticated using (bucket_id = 'images');
create policy "Admin can upload images" on storage.objects for insert to authenticated with check (bucket_id = 'images' and is_admin());
create policy "Admin can change images" on storage.objects for update to authenticated using (bucket_id = 'images' and is_admin());
create policy "Admin can delete images" on storage.objects for delete to authenticated using (bucket_id = 'images' and is_admin());

-- Banner photo position (0 = top, 100 = bottom)
alter table banner_slides add column if not exists focus_y int not null default 50;
