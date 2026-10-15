-- Private guest-owned ledger. QR tokens are neither inputs nor authority.
create index orders_guest_history_idx on public.orders
  (customer_id, restaurant_id, created_at desc, id desc) where customer_id is not null;

create function public.get_guest_order_history(restaurant_slug text, before_order_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare guest uuid; r public.restaurants%rowtype; cursor_order public.orders%rowtype;
  amounts jsonb; history jsonb; next_cursor uuid;
begin
  guest := private.require_order_guest();
  if restaurant_slug is null or restaurant_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(restaurant_slug)>120 then
    raise exception using errcode='P0001',message='INVALID_REQUEST';
  end if;
  select * into r from public.restaurants where slug=restaurant_slug
    and (is_published or exists(select 1 from public.orders o where o.restaurant_id=restaurants.id and o.customer_id=guest));
  if not found then return null; end if;
  if before_order_id is not null then
    select * into cursor_order from public.orders where id=before_order_id and restaurant_id=r.id and customer_id=guest;
    if not found then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  end if;
  -- Never add different currencies or lose integer precision in JSON.
  if exists(select 1 from public.orders where restaurant_id=r.id and customer_id=guest and currency<>r.currency) then
    raise exception using errcode='P0001',message='HISTORY_UNAVAILABLE';
  end if;
  select jsonb_build_object(
    'orderValueMinor',coalesce(sum(total_minor) filter(where status<>'cancelled'),0),
    'confirmedMinor',coalesce(sum(total_minor) filter(where status in ('accepted','preparing','ready','served')),0),
    'pendingMinor',coalesce(sum(total_minor) filter(where status='pending'),0),
    'cancelledMinor',coalesce(sum(total_minor) filter(where status='cancelled'),0),
    'confirmedCount',count(*) filter(where status in ('accepted','preparing','ready','served')),
    'pendingCount',count(*) filter(where status='pending'),
    'cancelledCount',count(*) filter(where status='cancelled'),'orderCount',count(*)) into amounts
    from public.orders where restaurant_id=r.id and customer_id=guest;
  if exists(select 1 from jsonb_each_text(amounts) a where a.value::numeric>9007199254740991) then
    raise exception using errcode='P0001',message='HISTORY_UNAVAILABLE';
  end if;
  with page as (
    select o.* from public.orders o where o.restaurant_id=r.id and o.customer_id=guest
      and (before_order_id is null or (o.created_at,o.id)<(cursor_order.created_at,cursor_order.id))
    order by o.created_at desc,o.id desc limit 21
  ), visible as (select * from page order by created_at desc,id desc limit 20)
  select coalesce(jsonb_agg(public.get_guest_order(restaurant_slug,v.id,null)
    ||jsonb_build_object('updatedAt',v.updated_at,'cancelReason',v.cancellation_reason)
    order by v.created_at desc,v.id desc),'[]'::jsonb),
    case when (select count(*) from page)>20 then
      (select id from visible order by created_at asc,id asc limit 1) else null end
    into history,next_cursor from visible v;
  return jsonb_build_object('restaurant',jsonb_build_object('id',r.id,'slug',r.slug,'name',r.name),
    'currency',r.currency,'timezone',r.timezone,'fetchedAt',statement_timestamp(),
    'totals',amounts,'orders',history,'nextCursor',next_cursor);
end;
$$;
revoke all on function public.get_guest_order_history(text,uuid) from public,anon,authenticated;
grant execute on function public.get_guest_order_history(text,uuid) to authenticated;
comment on function public.get_guest_order_history(text,uuid) is
  'Anonymous guest-owned restaurant order history and informational totals. Not a shared table bill or payment status.';
