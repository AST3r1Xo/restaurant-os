begin;

-- Direct status writes would bypass the workflow and its concurrency checks.
revoke update (status) on public.orders from authenticated;
drop policy orders_update_status on public.orders;
alter table public.orders
  add column accepted_at timestamptz,
  add column preparing_at timestamptz,
  add column ready_at timestamptz,
  add column served_at timestamptz,
  add column cancelled_at timestamptz,
  add column cancellation_reason text check (cancellation_reason is null or length(btrim(cancellation_reason)) between 2 and 300);

create table private.order_status_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  order_id uuid not null,
  actor_id uuid references auth.users(id) on delete set null,
  previous_status public.order_status not null,
  next_status public.order_status not null,
  reason text,
  occurred_at timestamptz not null default clock_timestamp(),
  foreign key (restaurant_id,order_id) references public.orders(restaurant_id,id) on delete restrict
);
create index order_status_events_order_idx on private.order_status_events(restaurant_id,order_id,occurred_at);
alter table private.order_status_events enable row level security;
revoke all on private.order_status_events from public,anon,authenticated;
create index orders_completion_idx on public.orders(restaurant_id,updated_at desc) where status in ('served','cancelled');

create function private.require_staff_restaurant(target_restaurant uuid) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid := auth.uid();
begin
  if actor is null or (auth.jwt()->>'is_anonymous') is distinct from 'false'
     or (auth.jwt()->>'sub') is distinct from actor::text then
    raise exception using errcode='P0001',message='STAFF_REQUIRED';
  end if;
  perform 1 from public.restaurant_members where restaurant_id=target_restaurant and user_id=actor for share;
  if not found then raise exception using errcode='P0001',message='STAFF_FORBIDDEN'; end if;
  return actor;
end;
$$;

create function public.transition_order(target_restaurant uuid,target_order uuid,expected_status public.order_status,next_status public.order_status,reason text default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; o public.orders%rowtype; changed_at timestamptz := clock_timestamp(); clean_reason text;
begin
  actor := private.require_staff_restaurant(target_restaurant);
  select * into o from public.orders where restaurant_id=target_restaurant and id=target_order for update;
  if not found then raise exception using errcode='P0001',message='ORDER_NOT_FOUND'; end if;
  if expected_status is null or o.status<>expected_status then
    raise exception using errcode='P0001',message='STATUS_CONFLICT';
  end if;
  if next_status is null or not (
    (o.status='pending' and next_status in ('accepted','cancelled')) or
    (o.status='accepted' and next_status='preparing') or
    (o.status='preparing' and next_status='ready') or
    (o.status='ready' and next_status='served')
  ) then raise exception using errcode='P0001',message='INVALID_TRANSITION'; end if;
  clean_reason := nullif(btrim(reason),'');
  if (next_status='cancelled' and (clean_reason is null or length(clean_reason) not between 2 and 300))
     or (next_status<>'cancelled' and clean_reason is not null) then
    raise exception using errcode='P0001',message='INVALID_REASON';
  end if;
  update public.orders set status=next_status,
    accepted_at=case when next_status='accepted' then changed_at else accepted_at end,
    preparing_at=case when next_status='preparing' then changed_at else preparing_at end,
    ready_at=case when next_status='ready' then changed_at else ready_at end,
    served_at=case when next_status='served' then changed_at else served_at end,
    cancelled_at=case when next_status='cancelled' then changed_at else cancelled_at end,
    cancellation_reason=case when next_status='cancelled' then clean_reason else cancellation_reason end
    where id=o.id;
  insert into private.order_status_events(restaurant_id,order_id,actor_id,previous_status,next_status,reason)
    values(target_restaurant,o.id,actor,o.status,next_status,clean_reason);
  return jsonb_build_object('id',o.id,'status',next_status,'updatedAt',changed_at,'cancelReason',clean_reason);
end;
$$;

create function public.get_kitchen_snapshot(target_restaurant uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare r public.restaurants%rowtype; start_day timestamptz; end_day timestamptz; orders jsonb; metrics jsonb;
begin
  perform private.require_staff_restaurant(target_restaurant);
  select * into r from public.restaurants where id=target_restaurant;
  -- Calendar days follow the restaurant's IANA timezone, including DST.
  start_day := date_trunc('day',clock_timestamp() at time zone r.timezone) at time zone r.timezone;
  end_day := (date_trunc('day',clock_timestamp() at time zone r.timezone)+interval '1 day') at time zone r.timezone;
  select jsonb_build_object(
    'pending',count(*) filter(where status='pending'),
    'preparing',count(*) filter(where status in ('accepted','preparing')),
    'ready',count(*) filter(where status='ready'),
    'completedToday',count(*) filter(where status in ('served','cancelled') and coalesce(served_at,cancelled_at,updated_at)>=start_day and coalesce(served_at,cancelled_at,updated_at)<end_day),
    'receivedToday',count(*) filter(where created_at>=start_day and created_at<end_day)
  ) into metrics from public.orders where restaurant_id=target_restaurant;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',o.id,'reference',o.order_code,'restaurantId',o.restaurant_id,
    'tableLabel',coalesce(o.table_label,t.label),'status',o.status,'currency',o.currency,
    'totalMinor',o.total_minor,'createdAt',o.created_at,'updatedAt',o.updated_at,
    'notes',o.notes,'cancelReason',o.cancellation_reason,
    'items',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.product_name,'quantity',i.quantity,'unitPriceMinor',i.unit_price_minor,'lineTotalMinor',i.line_total_minor,'options',i.selected_options,'notes',i.notes) order by i.created_at,i.id),'[]'::jsonb) from public.order_items i where i.order_id=o.id and i.restaurant_id=target_restaurant)
  ) order by o.created_at,o.id),'[]'::jsonb) into orders
  from (
    (select * from public.orders where restaurant_id=target_restaurant and status not in ('served','cancelled') order by created_at,id limit 300)
    union all
    (select * from public.orders where restaurant_id=target_restaurant and status in ('served','cancelled') and coalesce(served_at,cancelled_at,updated_at)>=start_day and coalesce(served_at,cancelled_at,updated_at)<end_day order by updated_at desc,id limit 100)
  ) o join public.dining_tables t on t.id=o.table_id and t.restaurant_id=o.restaurant_id;
  return jsonb_build_object('restaurantId',r.id,'timezone',r.timezone,'metrics',metrics,'orders',orders,'fetchedAt',clock_timestamp());
end;
$$;

create function public.get_guest_order_progress(restaurant_slug text,order_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare guest uuid; result jsonb;
begin
  guest := private.require_order_guest();
  select jsonb_build_object('id',o.id,'restaurantId',o.restaurant_id,'status',o.status,'updatedAt',o.updated_at,'cancelReason',o.cancellation_reason)
    into result from public.orders o join public.restaurants r on r.id=o.restaurant_id
    where r.slug=restaurant_slug and o.id=order_id and o.customer_id=guest;
  return result;
end;
$$;
revoke all on function private.require_staff_restaurant(uuid) from public,anon,authenticated;
revoke all on function public.transition_order(uuid,uuid,public.order_status,public.order_status,text),public.get_kitchen_snapshot(uuid),public.get_guest_order_progress(text,uuid) from public,anon,authenticated;
grant execute on function public.transition_order(uuid,uuid,public.order_status,public.order_status,text),public.get_kitchen_snapshot(uuid),public.get_guest_order_progress(text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
