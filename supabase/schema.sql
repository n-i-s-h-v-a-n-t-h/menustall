-- =====================================================================
-- ChaiMenu — database schema, security, realtime, storage and seed data
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- It is safe to run again: objects are created "if not exists" and the
-- seed only inserts when the tables are empty.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------

create table if not exists public.shop_settings (
  id int primary key default 1 check (id = 1),
  shop_name text not null default 'My Tea Stall',
  tagline text default 'Freshly brewed, every cup',
  logo_url text,
  open_time time default '06:00',
  close_time time default '22:00',
  is_open boolean not null default true,       -- manual open/closed override
  announcement text,                           -- "Hot samosas at 5 PM 🔥"
  currency_symbol text not null default '₹',
  base_url text,                               -- domain used inside QR codes
  updated_at timestamptz default now()
);

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  emoji text,
  sort_order int not null default 0,
  is_visible boolean not null default true,
  created_at timestamptz default now()
);

create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  description text,
  price numeric(8,2) not null check (price >= 0),
  image_url text,
  is_veg boolean not null default true,
  tags text[] not null default '{}',           -- 'bestseller','new','spicy','must_try'
  in_stock boolean not null default true,
  track_qty boolean not null default false,
  stock_qty int check (stock_qty is null or stock_qty >= 0),
  available_from time,                         -- e.g. snacks only after 16:00
  available_to time,
  last_restocked_at timestamptz,
  last_stockout_at timestamptz,
  sort_order int not null default 0,
  is_visible boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.tables (
  id uuid primary key default gen_random_uuid(),
  table_number int not null unique check (table_number > 0),
  label text,
  is_active boolean not null default true,
  created_at timestamptz default now()
);

create table if not exists public.stock_events (
  id bigint generated always as identity primary key,
  item_id uuid references public.menu_items(id) on delete cascade,
  event text not null check (event in ('restocked','stock_out','qty_changed')),
  qty int,
  created_at timestamptz default now()
);

create table if not exists public.scans (      -- anonymous, no personal data
  id bigint generated always as identity primary key,
  table_number int,
  scanned_at timestamptz default now()
);

create table if not exists public.item_views ( -- anonymous popularity signal
  id bigint generated always as identity primary key,
  item_id uuid references public.menu_items(id) on delete cascade,
  viewed_at timestamptz default now()
);

-- ---------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------

create index if not exists menu_items_category_sort_idx on public.menu_items (category_id, sort_order);
create index if not exists stock_events_created_idx     on public.stock_events (created_at desc);
create index if not exists scans_scanned_idx            on public.scans (scanned_at);
create index if not exists item_views_item_viewed_idx   on public.item_views (item_id, viewed_at);
create index if not exists categories_sort_idx          on public.categories (sort_order);

-- ---------------------------------------------------------------------
-- 3. Helper: is the current user an admin?
--    SECURITY DEFINER so it can read `admins` even though RLS hides it.
-- ---------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

grant execute on function public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Stock triggers on menu_items
-- ---------------------------------------------------------------------

-- BEFORE: keep timestamps right and apply quantity rules.
create or replace function public.menu_items_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  restoring boolean := coalesce(current_setting('chaimenu.restoring', true), '') = 'on';
begin
  new.updated_at := now();

  if not restoring and new.track_qty and new.stock_qty is not null then
    if new.stock_qty = 0
       and (tg_op = 'INSERT' or old.stock_qty is distinct from new.stock_qty or old.track_qty is distinct from new.track_qty) then
      new.in_stock := false;
    elsif tg_op = 'UPDATE'
      and coalesce(old.stock_qty, 0) = 0
      and new.stock_qty > 0
      and old.in_stock = false
      and new.in_stock = false then
      new.in_stock := true;
    end if;
  end if;

  if tg_op = 'UPDATE' and not restoring then
    if old.in_stock = false and new.in_stock = true then
      new.last_restocked_at := now();
    elsif old.in_stock = true and new.in_stock = false then
      new.last_stockout_at := now();
    end if;
  end if;

  return new;
end;
$$;

-- AFTER: write the stock activity log. SECURITY DEFINER so the log is
-- always written regardless of who made the change.
create or replace function public.menu_items_after_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.in_stock is distinct from new.in_stock then
    insert into public.stock_events (item_id, event, qty)
    values (new.id, case when new.in_stock then 'restocked' else 'stock_out' end, new.stock_qty);
  end if;

  if old.stock_qty is distinct from new.stock_qty and new.track_qty then
    insert into public.stock_events (item_id, event, qty)
    values (new.id, 'qty_changed', new.stock_qty);
  end if;

  return new;
end;
$$;

drop trigger if exists menu_items_before_write on public.menu_items;
create trigger menu_items_before_write
  before insert or update on public.menu_items
  for each row execute function public.menu_items_before_write();

drop trigger if exists menu_items_after_update on public.menu_items;
create trigger menu_items_after_update
  after update on public.menu_items
  for each row execute function public.menu_items_after_update();

-- Keep shop_settings.updated_at fresh.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists shop_settings_touch on public.shop_settings;
create trigger shop_settings_touch
  before update on public.shop_settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 5. Row Level Security
-- ---------------------------------------------------------------------

alter table public.shop_settings enable row level security;
alter table public.admins        enable row level security;
alter table public.categories    enable row level security;
alter table public.menu_items    enable row level security;
alter table public.tables        enable row level security;
alter table public.stock_events  enable row level security;
alter table public.scans         enable row level security;
alter table public.item_views    enable row level security;

-- shop_settings: everyone reads, admins write.
drop policy if exists "settings read"   on public.shop_settings;
drop policy if exists "settings write"  on public.shop_settings;
create policy "settings read"  on public.shop_settings for select using (true);
create policy "settings write" on public.shop_settings for all
  using (public.is_admin()) with check (public.is_admin());

-- admins: a signed-in user may only see their own row. No client writes.
drop policy if exists "admins self read" on public.admins;
create policy "admins self read" on public.admins for select
  to authenticated using (user_id = auth.uid());

-- categories: visible ones are public; admins see and change everything.
drop policy if exists "categories read"  on public.categories;
drop policy if exists "categories write" on public.categories;
create policy "categories read"  on public.categories for select
  using (is_visible or public.is_admin());
create policy "categories write" on public.categories for all
  using (public.is_admin()) with check (public.is_admin());

-- menu_items: visible ones are public; admins see and change everything.
drop policy if exists "items read"  on public.menu_items;
drop policy if exists "items write" on public.menu_items;
create policy "items read"  on public.menu_items for select
  using (is_visible or public.is_admin());
create policy "items write" on public.menu_items for all
  using (public.is_admin()) with check (public.is_admin());

-- tables: active ones are public; admins see and change everything.
drop policy if exists "tables read"  on public.tables;
drop policy if exists "tables write" on public.tables;
create policy "tables read"  on public.tables for select
  using (is_active or public.is_admin());
create policy "tables write" on public.tables for all
  using (public.is_admin()) with check (public.is_admin());

-- stock_events: admins only.
drop policy if exists "stock events admin" on public.stock_events;
create policy "stock events admin" on public.stock_events for all
  using (public.is_admin()) with check (public.is_admin());

-- scans: anyone may insert (sanity-checked); only admins read/delete.
drop policy if exists "scans insert"     on public.scans;
drop policy if exists "scans admin read" on public.scans;
drop policy if exists "scans admin del"  on public.scans;
create policy "scans insert" on public.scans for insert to anon, authenticated
  with check (
    (table_number is null or table_number between 1 and 10000)
    and scanned_at between now() - interval '1 minute' and now() + interval '1 minute'
  );
create policy "scans admin read" on public.scans for select using (public.is_admin());
create policy "scans admin del"  on public.scans for delete using (public.is_admin());

-- item_views: anyone may insert for a visible item; only admins read/delete.
drop policy if exists "views insert"     on public.item_views;
drop policy if exists "views admin read" on public.item_views;
drop policy if exists "views admin del"  on public.item_views;
create policy "views insert" on public.item_views for insert to anon, authenticated
  with check (
    exists (select 1 from public.menu_items m where m.id = item_id and m.is_visible)
    and viewed_at between now() - interval '1 minute' and now() + interval '1 minute'
  );
create policy "views admin read" on public.item_views for select using (public.is_admin());
create policy "views admin del"  on public.item_views for delete using (public.is_admin());

-- ---------------------------------------------------------------------
-- 6. Read-only functions
-- ---------------------------------------------------------------------

-- Public "Popular" row: only aggregated counts leave the database,
-- never individual view rows. Returns nothing until there is enough data.
create or replace function public.popular_items(days int default 7, lim int default 6)
returns table (item_id uuid, views bigint)
language sql
stable
security definer
set search_path = public
as $$
  with counts as (
    select v.item_id, count(*) as views
    from public.item_views v
    join public.menu_items m on m.id = v.item_id and m.is_visible
    where v.viewed_at > now() - make_interval(days => greatest(1, least(days, 30)))
    group by v.item_id
  )
  select c.item_id, c.views
  from counts c
  where (select coalesce(sum(views), 0) from counts) >= 20
    and c.views >= 3
  order by c.views desc
  limit greatest(1, least(lim, 12));
$$;

grant execute on function public.popular_items(int, int) to anon, authenticated;

-- Owner dashboard numbers in one round trip, computed in the shop time zone.
create or replace function public.admin_stats(tz text default 'Asia/Kolkata')
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  zone text := tz;
  today_start timestamptz;
  result json;
begin
  if not public.is_admin() then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if not exists (select 1 from pg_timezone_names where name = zone) then
    zone := 'Asia/Kolkata';
  end if;

  today_start := (date_trunc('day', now() at time zone zone)) at time zone zone;

  select json_build_object(
    'scans_today', (select count(*) from public.scans where scanned_at >= today_start),
    'scans_yesterday', (select count(*) from public.scans
                        where scanned_at >= today_start - interval '1 day'
                          and scanned_at <  today_start),
    'busiest_table', (select json_build_object('table_number', table_number, 'scans', count(*))
                      from public.scans
                      where scanned_at >= today_start and table_number is not null
                      group by table_number
                      order by count(*) desc, table_number
                      limit 1),
    'scans_by_hour', (select json_agg(coalesce(s.n, 0) order by h.hour)
                      from generate_series(0, 23) as h(hour)
                      left join (
                        select extract(hour from scanned_at at time zone zone)::int as hour, count(*) as n
                        from public.scans
                        where scanned_at >= today_start
                        group by 1
                      ) s on s.hour = h.hour),
    'top_items', (select coalesce(json_agg(t), '[]'::json) from (
                    select v.item_id, m.name, count(*) as views
                    from public.item_views v
                    join public.menu_items m on m.id = v.item_id
                    where v.viewed_at > now() - interval '7 days'
                    group by v.item_id, m.name
                    order by count(*) desc
                    limit 8
                  ) t)
  ) into result;

  return result;
end;
$$;

revoke execute on function public.admin_stats(text) from public, anon;
grant execute on function public.admin_stats(text) to authenticated;

-- Undo for the Stock screen: put the stock state of an item back exactly as it
-- was, including its timestamps.
create or replace function public.restore_stock(
  p_item uuid,
  p_in_stock boolean,
  p_stock_qty int,
  p_last_restocked_at timestamptz,
  p_last_stockout_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  perform set_config('chaimenu.restoring', 'on', true);
  update public.menu_items
     set in_stock = p_in_stock,
         stock_qty = case when track_qty then p_stock_qty else stock_qty end,
         last_restocked_at = p_last_restocked_at,
         last_stockout_at = p_last_stockout_at
   where id = p_item;
  perform set_config('chaimenu.restoring', 'off', true);
end;
$$;

revoke execute on function public.restore_stock(uuid, boolean, int, timestamptz, timestamptz) from public, anon;
grant execute on function public.restore_stock(uuid, boolean, int, timestamptz, timestamptz) to authenticated;

-- First-run setup: lets the dashboard guide the owner without any SQL.
-- Only says whether an owner exists and whether the shop row exists.
create or replace function public.setup_status()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'has_owner', exists (select 1 from public.admins),
    'has_shop', exists (select 1 from public.shop_settings where id = 1),
    'items', (select count(*) from public.menu_items)
  );
$$;

grant execute on function public.setup_status() to anon, authenticated;

-- The first signed-in user becomes the owner. Once an owner exists this
-- only reports whether the caller is already one; it never adds anyone.
create or replace function public.claim_ownership()
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  lock table public.admins in exclusive mode;
  if not exists (select 1 from public.admins) then
    insert into public.admins (user_id) values (auth.uid());
    insert into public.shop_settings (id) values (1) on conflict (id) do nothing;
    return true;
  end if;
  return exists (select 1 from public.admins where user_id = auth.uid());
end;
$$;

revoke execute on function public.claim_ownership() from public, anon;
grant execute on function public.claim_ownership() to authenticated;

-- ---------------------------------------------------------------------
-- 7. Realtime
-- ---------------------------------------------------------------------

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['menu_items', 'categories', 'shop_settings', 'stock_events'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Seed data (only when empty)
-- ---------------------------------------------------------------------

insert into public.shop_settings (id, shop_name, tagline, announcement)
values (1, 'Anna''s Chai Kadai', 'Freshly brewed, every cup', 'Hot samosas & bajji from 4 PM 🔥')
on conflict (id) do nothing;

do $$
declare
  c_tea uuid; c_special uuid; c_cool uuid; c_snack uuid; c_bake uuid;
begin
  if exists (select 1 from public.categories) then
    return;
  end if;

  insert into public.categories (name, emoji, sort_order) values ('Tea', '☕', 1)      returning id into c_tea;
  insert into public.categories (name, emoji, sort_order) values ('Specials', '🫖', 2) returning id into c_special;
  insert into public.categories (name, emoji, sort_order) values ('Coolers', '🥤', 3)  returning id into c_cool;
  insert into public.categories (name, emoji, sort_order) values ('Snacks', '🥟', 4)   returning id into c_snack;
  insert into public.categories (name, emoji, sort_order) values ('Bakery', '🍪', 5)   returning id into c_bake;

  insert into public.menu_items
    (category_id, name, description, price, is_veg, tags, sort_order,
     available_from, available_to, track_qty, stock_qty, last_restocked_at)
  values
    (c_tea, 'Masala Chai', 'Strong CTC tea simmered with ginger, cardamom, clove and pepper.', 15, true, '{bestseller,must_try}', 1, null, null, false, null, now() - interval '25 minutes'),
    (c_tea, 'Ginger Tea', 'Fresh crushed ginger, perfect for a rainy evening.', 15, true, '{}', 2, null, null, false, null, null),
    (c_tea, 'Elaichi Tea', 'Fragrant green cardamom chai, lightly sweet.', 15, true, '{}', 3, null, null, false, null, null),
    (c_tea, 'Lemon Tea', 'Light black tea with lemon and a pinch of rock salt.', 12, true, '{}', 4, null, null, false, null, null),
    (c_tea, 'Filter Coffee', 'Kumbakonam-style degree coffee in a davara tumbler.', 20, true, '{bestseller}', 5, null, null, false, null, null),

    (c_special, 'Badam Milk', 'Warm milk with ground almonds, saffron and cardamom.', 30, true, '{must_try}', 1, null, null, false, null, null),
    (c_special, 'Sukku Malli Coffee', 'Dry ginger & coriander kashayam with palm jaggery.', 20, true, '{new}', 2, null, null, false, null, null),
    (c_special, 'Horlicks', 'Hot malted milk, just like home.', 25, true, '{}', 3, null, null, false, null, null),

    (c_cool, 'Rose Milk', 'Chilled milk with rose syrup and sabja seeds.', 30, true, '{bestseller}', 1, '10:00', '21:30', false, null, null),
    (c_cool, 'Lime Soda', 'Sweet, salt or mixed — fizzing fresh.', 25, true, '{}', 2, '10:00', '21:30', false, null, null),
    (c_cool, 'Nannari Sarbath', 'Sarsaparilla root syrup with lemon. Summer in a glass.', 25, true, '{new}', 3, '10:00', '21:30', false, null, null),

    (c_snack, 'Samosa', 'Crisp pastry stuffed with spiced potato and peas.', 15, true, '{bestseller,spicy}', 1, '16:00', '21:30', true, 24, now() - interval '40 minutes'),
    (c_snack, 'Medu Vada', 'Crispy urad dal vada with coconut chutney.', 12, true, '{}', 2, '06:00', '11:00', false, null, null),
    (c_snack, 'Bajji', 'Raw banana & chilli bajji, hot off the kadai.', 15, true, '{spicy,must_try}', 3, '16:00', '21:30', true, 3, null),
    (c_snack, 'Egg Puff', 'Flaky puff pastry with masala egg.', 25, false, '{}', 4, null, null, false, null, null),
    (c_snack, 'Veg Puff', 'Flaky puff pastry with spiced vegetables.', 20, true, '{}', 5, null, null, false, null, null),

    (c_bake, 'Bun Butter Jam', 'Soft sweet bun with butter and mixed-fruit jam.', 25, true, '{bestseller}', 1, null, null, false, null, null),
    (c_bake, 'Osmania Biscuit', 'Hyderabadi melt-in-mouth butter biscuit, 2 pcs.', 10, true, '{}', 2, null, null, false, null, null),
    (c_bake, 'Coconut Bun', 'Bun filled with sweet coconut and tutti-frutti.', 20, true, '{}', 3, null, null, false, null, null),
    (c_bake, 'Rusk', 'Twice-baked crunchy rusk, perfect for dunking.', 10, true, '{}', 4, null, null, false, null, null);

  insert into public.tables (table_number)
  select g from generate_series(1, 6) g
  on conflict (table_number) do nothing;
end;
$$;

-- ---------------------------------------------------------------------
-- 9. Storage: public bucket for menu photos and the shop logo
--    Wrapped so that, if your project restricts storage changes from the
--    SQL editor, the rest of the setup still succeeds (you will see a NOTICE
--    and can create the bucket by hand: README → "Images not uploading").
-- ---------------------------------------------------------------------

do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('menu-images', 'menu-images', true, 2097152,
          array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;
exception when others then
  raise notice 'ChaiMenu: could not create the menu-images bucket (%). Create it in Storage → New bucket (public).', sqlerrm;
end;
$$;

do $$
begin
  execute 'drop policy if exists "menu-images public read"  on storage.objects';
  execute 'drop policy if exists "menu-images admin insert" on storage.objects';
  execute 'drop policy if exists "menu-images admin update" on storage.objects';
  execute 'drop policy if exists "menu-images admin delete" on storage.objects';
  execute 'create policy "menu-images public read" on storage.objects for select '
       || 'using (bucket_id = ''menu-images'')';
  execute 'create policy "menu-images admin insert" on storage.objects for insert to authenticated '
       || 'with check (bucket_id = ''menu-images'' and public.is_admin())';
  execute 'create policy "menu-images admin update" on storage.objects for update to authenticated '
       || 'using (bucket_id = ''menu-images'' and public.is_admin()) '
       || 'with check (bucket_id = ''menu-images'' and public.is_admin())';
  execute 'create policy "menu-images admin delete" on storage.objects for delete to authenticated '
       || 'using (bucket_id = ''menu-images'' and public.is_admin())';
exception when others then
  raise notice 'ChaiMenu: could not create storage policies (%). See README → "Images not uploading".', sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------
-- 10. Owner account
--     You do not need to run anything here: the FIRST account that logs in
--     to /admin becomes the owner automatically (claim_ownership below).
--     To add another owner later, run (with their User UID):
--
--   insert into public.admins (user_id) values ('00000000-0000-0000-0000-000000000000');
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 11. Tell the Supabase API to pick up the new tables and functions now
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';
