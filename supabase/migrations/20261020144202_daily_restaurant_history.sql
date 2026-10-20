begin;

-- Date-range reads and keyset history also cover legacy orders without a visit.
create index orders_restaurant_history_idx on public.orders(restaurant_id,created_at desc,id desc);

create function public.get_daily_restaurant_report(
  target_restaurant uuid,
  report_day date default null,
  report_currency text default null,
  before_order uuid default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  actor uuid := auth.uid(); r public.restaurants%rowtype; day date;
  start_day timestamptz; end_day timestamptz; currencies text[]; chosen_currency text;
  totals jsonb; products jsonb; orders jsonb; next_cursor uuid;
  cursor_row public.orders%rowtype;
begin
  -- Read-only authorization: no menu mutation locks, no privileged app client.
  if actor is null or (auth.jwt()->>'is_anonymous') is distinct from 'false'
    or (auth.jwt()->>'sub') is distinct from actor::text then
    raise exception using errcode='P0001',message='STAFF_REQUIRED';
  end if;
  if not private.is_member(target_restaurant) then
    raise exception using errcode='P0001',message='STAFF_FORBIDDEN';
  end if;
  if not private.can_manage(target_restaurant) then
    raise exception using errcode='P0001',message='MANAGER_REQUIRED';
  end if;
  select * into r from public.restaurants where id=target_restaurant;
  day := coalesce(report_day,(current_timestamp at time zone r.timezone)::date);
  if day not between date '2000-01-01' and date '2100-12-31' then
    raise exception using errcode='P0001',message='REPORT_INVALID';
  end if;
  -- Calendar boundaries are independent local midnights: 23/25-hour DST days
  -- must not be approximated by adding 24 hours to a UTC timestamp.
  start_day := day::timestamp at time zone r.timezone;
  end_day := (day+1)::timestamp at time zone r.timezone;
  select array_agg(distinct o.currency order by o.currency) into currencies
    from public.orders o where o.restaurant_id=target_restaurant and o.created_at>=start_day and o.created_at<end_day;
  currencies := coalesce(currencies,array[r.currency]);
  chosen_currency := coalesce(report_currency,case when r.currency=any(currencies) then r.currency else currencies[1] end);
  if chosen_currency<>all(currencies) then
    raise exception using errcode='P0001',message='REPORT_INVALID';
  end if;
  if before_order is not null then
    select * into cursor_row from public.orders o where o.id=before_order and o.restaurant_id=target_restaurant
      and o.currency=chosen_currency and o.created_at>=start_day and o.created_at<end_day;
    if not found then raise exception using errcode='P0001',message='REPORT_INVALID'; end if;
  end if;
  select jsonb_build_object(
    'orderCount',count(*),
    'confirmedCount',count(*) filter(where o.status in ('accepted','preparing','ready','served')),
    'pendingCount',count(*) filter(where o.status='pending'),
    'cancelledCount',count(*) filter(where o.status='cancelled'),
    'servedCount',count(*) filter(where o.status='served'),
    'confirmedMinor',coalesce(sum(o.total_minor) filter(where o.status in ('accepted','preparing','ready','served')),0),
    'pendingMinor',coalesce(sum(o.total_minor) filter(where o.status='pending'),0),
    'cancelledMinor',coalesce(sum(o.total_minor) filter(where o.status='cancelled'),0)
  ) into totals from public.orders o where o.restaurant_id=target_restaurant and o.currency=chosen_currency
    and o.created_at>=start_day and o.created_at<end_day;

  select coalesce(jsonb_agg(jsonb_build_object('productId',p.product_id,'name',p.name,'quantity',p.quantity,
    'orderCount',p.order_count,'totalMinor',p.total_minor) order by p.quantity desc,p.name,p.product_id),'[]'::jsonb) into products
  from (
    select i.product_id,(array_agg(i.product_name order by o.created_at desc,o.id desc,i.id desc))[1] as name,
      sum(i.quantity) as quantity,count(distinct o.id) as order_count,sum(i.line_total_minor) as total_minor
    from public.order_items i join public.orders o on o.restaurant_id=i.restaurant_id and o.id=i.order_id
    where o.restaurant_id=target_restaurant and o.currency=chosen_currency
      and o.created_at>=start_day and o.created_at<end_day and o.status in ('accepted','preparing','ready','served')
    group by i.product_id
  ) p;
  totals := totals || jsonb_build_object('dishCount',coalesce((select sum((p->>'quantity')::bigint) from jsonb_array_elements(products) p),0));

  with page as materialized (
    select * from public.orders o where o.restaurant_id=target_restaurant and o.currency=chosen_currency
      and o.created_at>=start_day and o.created_at<end_day
      and (before_order is null or (o.created_at,o.id)<(cursor_row.created_at,cursor_row.id))
      order by o.created_at desc,o.id desc limit 41
  ), visible as (select * from page order by created_at desc,id desc limit 40)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',o.id,'reference',o.order_code,'restaurantId',o.restaurant_id,'tableLabel',coalesce(o.table_label,''),
    'status',o.status,'currency',o.currency,'totalMinor',o.total_minor,'createdAt',o.created_at,'updatedAt',o.updated_at,
    'notes',o.notes,'cancelReason',o.cancellation_reason,
    'items',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.product_name,'quantity',i.quantity,
      'unitPriceMinor',i.unit_price_minor,'lineTotalMinor',i.line_total_minor,'options',i.selected_options,'notes',i.notes)
      order by i.created_at,i.id),'[]'::jsonb) from public.order_items i where i.restaurant_id=target_restaurant and i.order_id=o.id)
  ) order by o.created_at desc,o.id desc),'[]'::jsonb),
  case when (select count(*) from page)>40 then (select id from visible order by created_at,id limit 1) else null end
  into orders,next_cursor from visible o;
  return jsonb_build_object('restaurantId',r.id,'day',day,'today',(current_timestamp at time zone r.timezone)::date,
    'timezone',r.timezone,'currency',chosen_currency,'currencies',currencies,
    'totals',totals,'products',products,'orders',orders,'nextCursor',next_cursor,'fetchedAt',current_timestamp);
end;
$$;

revoke all on function public.get_daily_restaurant_report(uuid,date,text,uuid) from public,anon,authenticated;
grant execute on function public.get_daily_restaurant_report(uuid,date,text,uuid) to authenticated;
comment on function public.get_daily_restaurant_report(uuid,date,text,uuid) is
  'Owner/manager-only local-calendar-day history from immutable order snapshots. Informational order value, never verified payment or revenue. All-day aggregates independent of paginated receipts.';
notify pgrst,'reload schema';
commit;
