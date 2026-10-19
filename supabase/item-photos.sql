-- Senra Sportswear: more than one photo per item (e.g. front and back).
-- Safe to run more than once. Run in Supabase → SQL Editor.
-- image_url stays the main photo; extra_images holds the rest, in order.
alter table products add column if not exists extra_images jsonb not null default '[]'::jsonb;
alter table club_items add column if not exists extra_images jsonb not null default '[]'::jsonb;
