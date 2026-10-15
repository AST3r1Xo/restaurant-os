begin;

alter table public.products add column ingredients text[] not null default '{}';

-- Groups belong to one product; required means min_selections > 0.
create table public.product_modifier_groups (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  product_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 120),
  description text not null default '',
  selection_type text not null default 'single' check (selection_type in ('single', 'multiple')),
  min_selections integer not null default 0,
  max_selections integer not null default 1,
  sort_order integer not null default 0 check (sort_order >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, product_id, name),
  check (min_selections >= 0 and max_selections between 1 and 20 and min_selections <= max_selections),
  check (selection_type <> 'single' or max_selections = 1),
  foreign key (restaurant_id, product_id) references public.products(restaurant_id, id) on delete cascade
);
create index product_modifier_groups_product_idx on public.product_modifier_groups(restaurant_id, product_id, sort_order);

create table public.modifier_options (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  group_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 120),
  price_adjustment_minor integer not null default 0 check (price_adjustment_minor between 0 and 1000000),
  sort_order integer not null default 0 check (sort_order >= 0),
  is_available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, group_id, name),
  foreign key (restaurant_id, group_id) references public.product_modifier_groups(restaurant_id, id) on delete cascade
);
create index modifier_options_group_idx on public.modifier_options(restaurant_id, group_id, sort_order);
create trigger product_modifier_groups_updated_at before update on public.product_modifier_groups for each row execute function public.set_updated_at();
create trigger modifier_options_updated_at before update on public.modifier_options for each row execute function public.set_updated_at();

alter table public.product_modifier_groups enable row level security;
alter table public.modifier_options enable row level security;
revoke all on public.product_modifier_groups, public.modifier_options from anon, authenticated;
grant select on public.product_modifier_groups, public.modifier_options to anon, authenticated;
grant insert, update, delete on public.product_modifier_groups, public.modifier_options to authenticated;

create policy modifier_groups_read on public.product_modifier_groups for select to anon, authenticated
using (private.is_member(restaurant_id) or (is_active and exists (
  select 1 from public.products p join public.restaurants r on r.id=p.restaurant_id
  join public.menu_categories c on c.id=p.category_id and c.restaurant_id=p.restaurant_id
  where p.id=product_id and p.restaurant_id=product_modifier_groups.restaurant_id
  and p.is_available and r.is_published and c.is_active
)));
create policy modifier_groups_manage on public.product_modifier_groups for all to authenticated
using (private.can_manage(restaurant_id)) with check (private.can_manage(restaurant_id));
create policy modifier_options_read on public.modifier_options for select to anon, authenticated
using (private.is_member(restaurant_id) or (is_available and exists (
  select 1 from public.product_modifier_groups g
  where g.id=group_id and g.restaurant_id=modifier_options.restaurant_id and g.is_active
)));
create policy modifier_options_manage on public.modifier_options for all to authenticated
using (private.can_manage(restaurant_id)) with check (private.can_manage(restaurant_id));

comment on column public.modifier_options.price_adjustment_minor is 'Additional price per unit in restaurant currency minor units. Checkout must read trusted current definitions.';
notify pgrst, 'reload schema';
commit;
