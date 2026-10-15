begin;

-- Ordering is explicitly enabled per restaurant; never add payment infrastructure.
alter table public.restaurants add column is_accepting_orders boolean not null default false;
grant update (is_accepting_orders) on public.restaurants to authenticated;
alter table public.orders
  add column idempotency_key uuid,
  add column request_fingerprint text check (request_fingerprint is null or length(request_fingerprint)=64),
  add column restaurant_name text,
  add column table_label text;
alter table public.orders add constraint orders_guest_idempotency_unique unique(customer_id,restaurant_id,idempotency_key);
alter table public.orders add constraint orders_submission_metadata_check check (
  (idempotency_key is null and request_fingerprint is null) or
  (idempotency_key is not null and request_fingerprint is not null and restaurant_name is not null and table_label is not null)
);
alter table public.order_items add column base_price_minor integer check (base_price_minor is null or base_price_minor>=0);
create index orders_guest_rate_idx on public.orders(customer_id,created_at desc);

create table private.order_reviews (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references auth.users(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  request_fingerprint text not null check(length(request_fingerprint)=64),
  snapshot jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp()+interval '10 minutes')
);
create index order_reviews_guest_created_idx on private.order_reviews(guest_id,created_at desc);
alter table private.order_reviews enable row level security;
revoke all on private.order_reviews from public,anon,authenticated;

create function private.require_order_guest() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare guest uuid := auth.uid();
begin
  if guest is null or (auth.jwt()->>'is_anonymous') is distinct from 'true'
     or (auth.jwt()->>'sub') is distinct from guest::text then
    raise exception using errcode='P0001',message='SESSION_REQUIRED';
  end if;
  return guest;
end;
$$;

create function private.normalize_order_items(items jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare line jsonb; result jsonb := '[]'; options jsonb; product uuid; quantity integer; total_quantity integer := 0;
begin
  if items is null or jsonb_typeof(items)<>'array' or jsonb_array_length(items) not between 1 and 50 or octet_length(items::text)>65536 then
    raise exception using errcode='P0001',message='INVALID_REQUEST';
  end if;
  for line in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(line)<>'object' or not(line ?& array['productId','optionIds','quantity']) or (line-array['productId','optionIds','quantity'])<>'{}'::jsonb
       or jsonb_typeof(line->'productId')<>'string' or (line->>'productId')!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
       or jsonb_typeof(line->'optionIds')<>'array' then
      raise exception using errcode='P0001',message='INVALID_REQUEST';
    end if;
    if jsonb_typeof(line->'quantity')<>'number' or (line->>'quantity')!~'^[0-9]{1,2}$' then
      raise exception using errcode='P0001',message='QUANTITY_INVALID';
    end if;
    quantity := (line->>'quantity')::integer;
    if quantity not between 1 and 99 then raise exception using errcode='P0001',message='QUANTITY_INVALID'; end if;
    total_quantity := total_quantity+quantity;
    if total_quantity>500 then raise exception using errcode='P0001',message='QUANTITY_INVALID'; end if;
    product := (line->>'productId')::uuid;
    if jsonb_array_length(line->'optionIds')>50 or exists (
      select 1 from jsonb_array_elements(line->'optionIds') option
      where jsonb_typeof(option)<>'string' or (option#>>'{}')!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    ) then raise exception using errcode='P0001',message='OPTIONS_INVALID'; end if;
    select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into options
    from (select (value#>>'{}')::uuid::text id from jsonb_array_elements(line->'optionIds')) options;
    if (select count(distinct value) from jsonb_array_elements(options))<>jsonb_array_length(options) then
      raise exception using errcode='P0001',message='OPTIONS_INVALID';
    end if;
    if exists(select 1 from jsonb_array_elements(result) prior where prior->>'productId'=product::text and prior->'optionIds'=options) then
      raise exception using errcode='P0001',message='INVALID_REQUEST';
    end if;
    result := result || jsonb_build_array(jsonb_build_object('productId',product::text,'optionIds',options,'quantity',quantity));
  end loop;
  return (select jsonb_agg(value order by value->>'productId',(value->'optionIds')::text) from jsonb_array_elements(result));
end;
$$;

create function private.order_request_fingerprint(table_token uuid,items jsonb) returns text
language sql immutable set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_object('tableToken',table_token::text,'items',items)::text,'UTF8')),'hex');
$$;

-- Lock current catalog rows, including unavailable definitions, in a consistent
-- order. Parent FOR UPDATE locks also block new modifier FK inserts until commit.
create function private.build_order_snapshot(restaurant_slug text,table_token uuid,items jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare r public.restaurants%rowtype; t public.dining_tables%rowtype; p public.products%rowtype;
  line jsonb; result jsonb := '[]'; options jsonb; group_row public.product_modifier_groups%rowtype;
  selected_count integer; selected_total integer; unit_price bigint; line_total bigint; total bigint := 0;
begin
  select * into r from public.restaurants where slug=restaurant_slug for share;
  if not found or not r.is_published or not r.is_accepting_orders then
    raise exception using errcode='P0001',message='RESTAURANT_UNAVAILABLE';
  end if;
  select * into t from public.dining_tables where restaurant_id=r.id and qr_token=table_token and is_active for share;
  if not found then raise exception using errcode='P0001',message='TABLE_INVALID'; end if;
  perform c.id from public.menu_categories c where c.restaurant_id=r.id and c.id in (
    select category_id from public.products where restaurant_id=r.id and id in (select (value->>'productId')::uuid from jsonb_array_elements(items))
  ) order by c.id for share;
  perform p0.id from public.products p0 where p0.restaurant_id=r.id and p0.id in (
    select (value->>'productId')::uuid from jsonb_array_elements(items)
  ) order by p0.id for update;
  perform g.id from public.product_modifier_groups g where g.restaurant_id=r.id and g.product_id in (
    select (value->>'productId')::uuid from jsonb_array_elements(items)
  ) order by g.id for update;
  perform o.id from public.modifier_options o join public.product_modifier_groups g on g.id=o.group_id and g.restaurant_id=o.restaurant_id
    where o.restaurant_id=r.id and g.product_id in(select (value->>'productId')::uuid from jsonb_array_elements(items))
    order by o.id for share of o;
  for line in select value from jsonb_array_elements(items) loop
    select product.* into p from public.products product
    join public.menu_categories c on c.id=product.category_id and c.restaurant_id=product.restaurant_id
    where product.id=(line->>'productId')::uuid and product.restaurant_id=r.id and product.is_available and c.is_active;
    if not found then raise exception using errcode='P0001',message='PRODUCT_UNAVAILABLE'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'groupId',g.id,'groupName',g.name,'name',o.name,'priceAdjustmentMinor',o.price_adjustment_minor)
      order by g.sort_order,g.id,o.sort_order,o.id),'[]'::jsonb),count(*) into options,selected_total
    from public.modifier_options o join public.product_modifier_groups g on g.id=o.group_id and g.restaurant_id=o.restaurant_id
    where o.restaurant_id=r.id and g.product_id=p.id and g.is_active and o.is_available
      and o.id in(select value::uuid from jsonb_array_elements_text(line->'optionIds'));
    if selected_total<>jsonb_array_length(line->'optionIds') then raise exception using errcode='P0001',message='OPTIONS_INVALID'; end if;
    for group_row in select * from public.product_modifier_groups where restaurant_id=r.id and product_id=p.id and is_active loop
      select count(*) into selected_count from public.modifier_options o where o.restaurant_id=r.id and o.group_id=group_row.id and o.is_available
        and o.id in(select value::uuid from jsonb_array_elements_text(line->'optionIds'));
      if selected_count<group_row.min_selections or selected_count>group_row.max_selections
         or (group_row.selection_type='single' and selected_count>1) then
        raise exception using errcode='P0001',message='OPTIONS_INVALID';
      end if;
    end loop;
    unit_price := p.price_minor::bigint + (select coalesce(sum((value->>'priceAdjustmentMinor')::bigint),0) from jsonb_array_elements(options));
    line_total := unit_price*(line->>'quantity')::integer;
    total := total+line_total;
    if unit_price>2147483647 or line_total>2147483647 or total>2147483647 then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
    result := result || jsonb_build_array(jsonb_build_object('productId',p.id,'productName',p.name,'quantity',(line->>'quantity')::integer,
      'basePriceMinor',p.price_minor,'unitPriceMinor',unit_price,'lineTotalMinor',line_total,'options',options));
  end loop;
  return jsonb_build_object('restaurant',jsonb_build_object('id',r.id,'slug',r.slug,'name',r.name),
    'table',jsonb_build_object('label',t.label),'currency',r.currency,'items',result,'totalMinor',total);
end;
$$;

create function public.review_guest_order(restaurant_slug text,table_token uuid,items jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare guest uuid; normalized jsonb; snapshot jsonb; review private.order_reviews%rowtype;
begin
  guest := private.require_order_guest();
  if restaurant_slug is null or length(restaurant_slug)>120 or table_token is null then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  normalized := private.normalize_order_items(items);
  perform pg_advisory_xact_lock(hashtextextended('order-guest:'||guest::text,0));
  if (select count(*) from private.order_reviews where guest_id=guest and created_at>clock_timestamp()-interval '1 minute')>=20 then
    raise exception using errcode='P0001',message='RATE_LIMITED';
  end if;
  snapshot := private.build_order_snapshot(restaurant_slug,table_token,normalized);
  insert into private.order_reviews(guest_id,restaurant_id,request_fingerprint,snapshot)
    values(guest,(snapshot->'restaurant'->>'id')::uuid,private.order_request_fingerprint(table_token,normalized),snapshot) returning * into review;
  return snapshot || jsonb_build_object('reviewId',review.id,'expiresAt',review.expires_at);
end;
$$;

create function public.get_guest_order(restaurant_slug text,order_id uuid default null,idempotency_key uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare guest uuid; o public.orders%rowtype; slug text; items jsonb;
begin
  guest := private.require_order_guest();
  if restaurant_slug is null or length(restaurant_slug)>120 or (order_id is null and idempotency_key is null) then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  select orders.* into o from public.orders orders join public.restaurants r on r.id=orders.restaurant_id
    where r.slug=restaurant_slug and orders.customer_id=guest
      and (order_id is null or orders.id=order_id) and (get_guest_order.idempotency_key is null or orders.idempotency_key=get_guest_order.idempotency_key);
  if not found then return null; end if;
  slug := restaurant_slug;
  select coalesce(jsonb_agg(jsonb_build_object('productId',i.product_id,'productName',i.product_name,'quantity',i.quantity,
    'basePriceMinor',coalesce(i.base_price_minor,i.unit_price_minor),'unitPriceMinor',i.unit_price_minor,
    'lineTotalMinor',i.line_total_minor,'options',i.selected_options) order by i.product_id,i.id),'[]'::jsonb) into items
    from public.order_items i where i.order_id=o.id and i.restaurant_id=o.restaurant_id;
  return jsonb_build_object('id',o.id,'reference',o.order_code,'restaurant',jsonb_build_object('id',o.restaurant_id,'slug',slug,'name',coalesce(o.restaurant_name,'')),
    'table',jsonb_build_object('label',coalesce(o.table_label,'')),'currency',o.currency,'status',o.status,
    'createdAt',o.created_at,'items',items,'subtotalMinor',o.subtotal_minor,'totalMinor',o.total_minor);
end;
$$;

create function public.create_guest_order(restaurant_slug text,table_token uuid,items jsonb,idempotency_key uuid,review_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare guest uuid; normalized jsonb; fingerprint text; restaurant uuid; existing public.orders%rowtype;
  review private.order_reviews%rowtype; snapshot jsonb; target_table_id uuid; created uuid; line jsonb;
begin
  guest := private.require_order_guest();
  if restaurant_slug is null or length(restaurant_slug)>120 or table_token is null or idempotency_key is null or review_id is null then
    raise exception using errcode='P0001',message='INVALID_REQUEST';
  end if;
  normalized := private.normalize_order_items(items);
  fingerprint := private.order_request_fingerprint(table_token,normalized);
  perform pg_advisory_xact_lock(hashtextextended('order-guest:'||guest::text,0));
  select id into restaurant from public.restaurants where slug=restaurant_slug;
  if not found then raise exception using errcode='P0001',message='RESTAURANT_UNAVAILABLE'; end if;
  select * into existing from public.orders o where o.restaurant_id=restaurant and o.customer_id=guest and o.idempotency_key=create_guest_order.idempotency_key;
  if found then
    if existing.request_fingerprint<>fingerprint then raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT'; end if;
    return public.get_guest_order(restaurant_slug,existing.id,null);
  end if;
  select * into review from private.order_reviews where id=review_id;
  if not found then raise exception using errcode='P0001',message='REVIEW_EXPIRED'; end if;
  if review.guest_id<>guest then raise exception using errcode='P0001',message='SESSION_REQUIRED'; end if;
  if review.restaurant_id<>restaurant or review.request_fingerprint<>fingerprint then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  if review.expires_at<clock_timestamp() then raise exception using errcode='P0001',message='REVIEW_EXPIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('order-table:'||table_token::text,0));
  snapshot := private.build_order_snapshot(restaurant_slug,table_token,normalized);
  if snapshot<>review.snapshot then raise exception using errcode='P0001',message='ORDER_CHANGED'; end if;
  select id into target_table_id from public.dining_tables where restaurant_id=restaurant and qr_token=table_token and is_active;
  if (select count(*) from public.orders o where o.customer_id=guest and o.created_at>clock_timestamp()-interval '5 minutes')>=5
     or (select count(*) from public.orders o where o.table_id=target_table_id and o.restaurant_id=restaurant and o.created_at>clock_timestamp()-interval '5 minutes')>=40 then
    raise exception using errcode='P0001',message='RATE_LIMITED';
  end if;
  insert into public.orders(restaurant_id,table_id,customer_id,currency,subtotal_minor,total_minor,status,idempotency_key,request_fingerprint,restaurant_name,table_label)
    values(restaurant,target_table_id,guest,snapshot->>'currency',(snapshot->>'totalMinor')::integer,(snapshot->>'totalMinor')::integer,'pending',idempotency_key,fingerprint,
      snapshot->'restaurant'->>'name',snapshot->'table'->>'label') returning id into created;
  for line in select value from jsonb_array_elements(snapshot->'items') loop
    insert into public.order_items(restaurant_id,order_id,product_id,product_name,base_price_minor,unit_price_minor,quantity,selected_options)
      values(restaurant,created,(line->>'productId')::uuid,line->>'productName',(line->>'basePriceMinor')::integer,
        (line->>'unitPriceMinor')::integer,(line->>'quantity')::integer,line->'options');
  end loop;
  return public.get_guest_order(restaurant_slug,created,null);
end;
$$;

revoke all on function private.require_order_guest(), private.normalize_order_items(jsonb),private.order_request_fingerprint(uuid,jsonb),private.build_order_snapshot(text,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.review_guest_order(text,uuid,jsonb),public.create_guest_order(text,uuid,jsonb,uuid,uuid),public.get_guest_order(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.review_guest_order(text,uuid,jsonb),public.create_guest_order(text,uuid,jsonb,uuid,uuid),public.get_guest_order(text,uuid,uuid) to authenticated;
comment on function public.create_guest_order(text,uuid,jsonb,uuid,uuid) is 'Atomic guest-owned order submission. No payment processing. Current trusted catalog must match guest-bound review; persisted idempotency returns original order.';
notify pgrst,'reload schema';
commit;
