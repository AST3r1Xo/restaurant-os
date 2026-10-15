begin;

create type public.staff_role as enum ('owner', 'manager', 'staff');
create type public.order_status as enum ('pending', 'accepted', 'preparing', 'ready', 'served', 'cancelled');

create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (length(btrim(name)) between 1 and 120),
  description text not null default '',
  logo_url text,
  cover_image_url text,
  currency text not null default 'EUR' check (currency in ('EUR', 'USD', 'GBP')),
  timezone text not null default 'Europe/Lisbon',
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Membership is provisioned through trusted server/admin tooling, never by guests.
create table public.restaurant_members (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.staff_role not null default 'staff',
  created_at timestamptz not null default now(),
  primary key (restaurant_id, user_id)
);
create index restaurant_members_user_idx on public.restaurant_members(user_id, restaurant_id);

create table public.dining_tables (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 60),
  qr_token uuid not null default gen_random_uuid() unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, label)
);

create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  description text not null default '',
  sort_order integer not null default 0 check (sort_order >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, name)
);
create index menu_categories_sort_idx on public.menu_categories(restaurant_id, sort_order);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  category_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 160),
  description text not null default '',
  price_minor integer not null check (price_minor >= 0),
  image_url text,
  model_glb_url text,
  model_usdz_url text,
  allergens text[] not null default '{}',
  dietary_tags text[] not null default '{}',
  is_available boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, id),
  foreign key (restaurant_id, category_id) references public.menu_categories(restaurant_id, id) on delete restrict
);
create index products_category_idx on public.products(restaurant_id, category_id, sort_order);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  table_id uuid not null,
  -- Future invisible Supabase anonymous identity: no customer signup required.
  customer_id uuid references auth.users(id) on delete set null,
  order_code text not null default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  status public.order_status not null default 'pending',
  currency text not null check (currency in ('EUR', 'USD', 'GBP')),
  subtotal_minor integer not null check (subtotal_minor >= 0),
  total_minor integer not null check (total_minor >= 0 and total_minor = subtotal_minor),
  notes text not null default '' check (length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, order_code),
  foreign key (restaurant_id, table_id) references public.dining_tables(restaurant_id, id) on delete restrict
);
create index orders_queue_idx on public.orders(restaurant_id, status, created_at desc);
create index orders_customer_idx on public.orders(customer_id, restaurant_id, created_at desc);
create index orders_table_idx on public.orders(restaurant_id, table_id);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  order_id uuid not null,
  product_id uuid not null,
  product_name text not null check (length(btrim(product_name)) between 1 and 160),
  unit_price_minor integer not null check (unit_price_minor >= 0),
  quantity integer not null check (quantity between 1 and 99),
  line_total_minor integer generated always as (unit_price_minor * quantity) stored,
  -- Selection + price snapshots; validated modifiers will be designed with checkout.
  selected_options jsonb not null default '[]'::jsonb check (jsonb_typeof(selected_options) = 'array'),
  notes text not null default '' check (length(notes) <= 500),
  created_at timestamptz not null default now(),
  foreign key (restaurant_id, order_id) references public.orders(restaurant_id, id) on delete cascade,
  foreign key (restaurant_id, product_id) references public.products(restaurant_id, id) on delete restrict
);
create index order_items_order_idx on public.order_items(restaurant_id, order_id);
create index order_items_product_idx on public.order_items(restaurant_id, product_id);

create function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger restaurants_updated_at before update on public.restaurants for each row execute function public.set_updated_at();
create trigger dining_tables_updated_at before update on public.dining_tables for each row execute function public.set_updated_at();
create trigger menu_categories_updated_at before update on public.menu_categories for each row execute function public.set_updated_at();
create trigger products_updated_at before update on public.products for each row execute function public.set_updated_at();
create trigger orders_updated_at before update on public.orders for each row execute function public.set_updated_at();

-- Private schema is not exposed by the Data API. Definer helpers avoid recursive
-- membership policies; caller identity always comes from the verified Auth JWT.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

create function private.is_member(target_restaurant uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.restaurant_members m
    where m.restaurant_id = target_restaurant and m.user_id = (select auth.uid())
  );
$$;

create function private.can_manage(target_restaurant uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.restaurant_members m
    where m.restaurant_id = target_restaurant and m.user_id = (select auth.uid())
      and m.role in ('owner', 'manager')
  );
$$;
revoke all on function private.is_member(uuid), private.can_manage(uuid) from public;
grant execute on function private.is_member(uuid), private.can_manage(uuid) to anon, authenticated;
revoke all on function public.set_updated_at() from public;

alter table public.restaurants enable row level security;
alter table public.restaurant_members enable row level security;
alter table public.dining_tables enable row level security;
alter table public.menu_categories enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- Override any broad Supabase defaults with explicit least-privilege grants.
revoke all on public.restaurants, public.restaurant_members, public.dining_tables,
  public.menu_categories, public.products, public.orders, public.order_items from anon, authenticated;
grant select on public.restaurants, public.menu_categories, public.products to anon, authenticated;
grant select on public.restaurant_members, public.dining_tables, public.orders, public.order_items to authenticated;
grant insert, update, delete on public.dining_tables, public.menu_categories, public.products to authenticated;
grant update (name, description, logo_url, cover_image_url, timezone, is_published) on public.restaurants to authenticated;
-- No direct client inserts/deletes or price changes on orders/items.
-- Checkout will require a trusted transactional function; guests cannot forge totals.
grant update (status) on public.orders to authenticated;

create policy restaurants_read on public.restaurants for select to anon, authenticated
  using (is_published or private.is_member(id));
create policy restaurants_manage on public.restaurants for update to authenticated
  using (private.can_manage(id)) with check (private.can_manage(id));

create policy members_read on public.restaurant_members for select to authenticated
  using (user_id = (select auth.uid()) or private.can_manage(restaurant_id));

-- QR tokens remain private. A future narrow server resolver validates one token.
create policy tables_read on public.dining_tables for select to authenticated
  using (private.is_member(restaurant_id));
create policy tables_manage on public.dining_tables for all to authenticated
  using (private.can_manage(restaurant_id)) with check (private.can_manage(restaurant_id));

create policy categories_read on public.menu_categories for select to anon, authenticated
  using (private.is_member(restaurant_id) or (is_active and exists (
    select 1 from public.restaurants r where r.id = restaurant_id and r.is_published
  )));
create policy categories_manage on public.menu_categories for all to authenticated
  using (private.can_manage(restaurant_id)) with check (private.can_manage(restaurant_id));

create policy products_read on public.products for select to anon, authenticated
  using (private.is_member(restaurant_id) or (is_available and exists (
    select 1 from public.restaurants r where r.id = restaurant_id and r.is_published
  ) and exists (
    select 1 from public.menu_categories c where c.id = category_id and c.restaurant_id = products.restaurant_id and c.is_active
  )));
create policy products_manage on public.products for all to authenticated
  using (private.can_manage(restaurant_id)) with check (private.can_manage(restaurant_id));

create policy orders_read on public.orders for select to authenticated
  using (private.is_member(restaurant_id) or customer_id = (select auth.uid()));
create policy orders_update_status on public.orders for update to authenticated
  using (private.is_member(restaurant_id)) with check (private.is_member(restaurant_id));
create policy order_items_read on public.order_items for select to authenticated
  using (exists (
    select 1 from public.orders o where o.id = order_id and o.restaurant_id = order_items.restaurant_id
      and (private.is_member(o.restaurant_id) or o.customer_id = (select auth.uid()))
  ));

-- Enable row-filtered Postgres Changes; RLS still controls who can subscribe.
alter publication supabase_realtime add table public.orders, public.order_items;

comment on column public.dining_tables.qr_token is 'Opaque, rotatable token. Never expose through public menu queries.';
comment on column public.orders.customer_id is 'Future invisible anonymous Auth identity; null after identity deletion preserves order history.';
comment on column public.order_items.product_name is 'Immutable display snapshot; archive products instead of deleting referenced rows.';

commit;
