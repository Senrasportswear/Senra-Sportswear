-- Senra Sportswear: password-locked club shops.
-- Safe to run more than once. Run in Supabase → SQL Editor.

-- Each club's password. Only the admin login can read or change these.
create table if not exists club_passwords (
  club_id text primary key,
  password text not null default ''
);
alter table club_passwords enable row level security;
grant select, insert, update, delete on club_passwords to authenticated;
drop policy if exists "Admin can do everything" on club_passwords;
create policy "Admin can do everything" on club_passwords for all to authenticated using (is_admin()) with check (is_admin());

-- Club shop items and prices are no longer visible to the public directly.
-- (The shop list — names, badges, open dates — still is.)
drop policy if exists "Anyone can view" on club_items;

-- Which clubs have a password, so the list can show a padlock. Ids only.
create or replace function locked_club_ids() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(club_id), '[]'::json) from club_passwords where trim(password) <> ''
$$;
grant execute on function locked_club_ids() to anon, authenticated;

-- Opens one club shop. Returns its items, prices and order totals only if the
-- password matches (not case-sensitive). Clubs with no password stay open.
create or replace function open_club_shop(p_club text, p_password text default '', p_since text default null)
returns json language plpgsql stable security definer set search_path = public as $$
declare pw text;
begin
  if not exists (select 1 from clubs where id::text = p_club) then
    return json_build_object('ok', false, 'reason', 'missing');
  end if;
  select password into pw from club_passwords where club_id = p_club;
  if coalesce(trim(pw), '') <> '' and lower(trim(pw)) <> lower(trim(coalesce(p_password, ''))) then
    return json_build_object('ok', false, 'reason', 'password');
  end if;
  return json_build_object(
    'ok', true,
    'items', coalesce((select json_agg(i) from club_items i where i.club_id::text = p_club), '[]'::json),
    'counts', club_item_counts(p_club, p_since)
  );
end $$;
grant execute on function open_club_shop(text, text, text) to anon, authenticated;

-- Order totals now only come through open_club_shop (so locked shops stay private).
revoke execute on function club_item_counts(text, text) from public, anon, authenticated;
