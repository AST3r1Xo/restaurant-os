-- Authorized shared dish snapshots only. Private receipts and guest identities retain their RLS.
create function private.session_bill_lines(target_session uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  with grouped as (
    select i.product_id,i.product_name,coalesce(i.base_price_minor,i.unit_price_minor) base_price,
      i.unit_price_minor,i.selected_options,o.status,sum(i.quantity)::bigint quantity,
      sum(i.line_total_minor)::bigint line_total,min(o.created_at) first_order
    from public.orders o join public.order_items i on i.order_id=o.id and i.restaurant_id=o.restaurant_id
    where o.session_id=target_session
    group by i.product_id,i.product_name,coalesce(i.base_price_minor,i.unit_price_minor),i.unit_price_minor,i.selected_options,o.status
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'key',md5(jsonb_build_array(product_id,product_name,base_price,unit_price_minor,selected_options,status)::text),
    'name',product_name,'quantity',quantity,'basePriceMinor',base_price,'unitPriceMinor',unit_price_minor,
    'lineTotalMinor',line_total,'status',status,
    'options',(select coalesce(jsonb_agg(jsonb_build_object('name',v->>'name','groupName',v->>'groupName',
      'priceAdjustmentMinor',(v->>'priceAdjustmentMinor')::integer) order by position),'[]'::jsonb)
      from jsonb_array_elements(selected_options) with ordinality as options(v,position))
    ) order by first_order,product_name,status,unit_price_minor,selected_options::text),'[]'::jsonb) from grouped;
$$;
revoke all on function private.session_bill_lines(uuid) from public,anon,authenticated;

create or replace function public.get_guest_table_bill(restaurant_slug text,table_token uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare guest uuid; rest uuid; target_table uuid; s public.table_sessions%rowtype; participant private.session_participants%rowtype; result jsonb;
begin
  guest:=private.require_order_guest();
  if restaurant_slug is null or length(restaurant_slug)>120 then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  select id into rest from public.restaurants where slug=restaurant_slug;
  if table_token is not null then
    select id into target_table from public.dining_tables where restaurant_id=rest and qr_token=table_token and is_active;
    if not found then raise exception using errcode='P0001',message='TABLE_INVALID'; end if;
  end if;
  select sessions.* into s from public.table_sessions sessions join private.session_participants p on p.session_id=sessions.id and p.guest_id=guest
    where sessions.restaurant_id=rest and (target_table is null or sessions.table_id=target_table)
    order by sessions.opened_at desc,sessions.id desc limit 1;
  if not found then return null; end if;
  select * into participant from private.session_participants where session_id=s.id and guest_id=guest;
  result:=jsonb_build_object('id',s.id,'restaurantId',rest,'tableLabel',s.table_label,'openedAt',s.opened_at,'closedAt',s.closed_at,
    'currency',s.currency,'fetchedAt',statement_timestamp(),
    'access',case when s.status='closed' then 'closed' when participant.authorized_at is null then 'waiting' else 'active' end);
  if s.status='active' and participant.authorized_at is not null then
    result:=result||jsonb_build_object('totals',private.session_totals(s.id),'lines',private.session_bill_lines(s.id),
      'request',(select jsonb_build_object('id',b.id,'status',b.status,'requestedAt',b.requested_at,'acknowledgedAt',b.acknowledged_at) from public.bill_requests b where b.session_id=s.id));
  end if;
  return result;
end;
$$;

-- Separate current-visit private history; all-visits history remains opt-in and unchanged.
create function public.get_guest_visit_order_history(restaurant_slug text, table_token uuid default null, before_order_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare guest uuid; r public.restaurants%rowtype; cursor_order public.orders%rowtype;
  amounts jsonb; history jsonb; next_cursor uuid; visit jsonb; visit_id uuid;
begin
  guest := private.require_order_guest();
  if restaurant_slug is null or restaurant_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(restaurant_slug)>120 then
    raise exception using errcode='P0001',message='INVALID_REQUEST';
  end if;
  select * into r from public.restaurants where slug=restaurant_slug
    and (is_published or exists(select 1 from public.orders o where o.restaurant_id=restaurants.id and o.customer_id=guest));
  if not found then return null; end if;
  visit:=public.get_guest_table_bill(restaurant_slug,table_token);
  if visit->>'access' in ('active','waiting') then visit_id:=(visit->>'id')::uuid; end if;
  if before_order_id is not null then
    select * into cursor_order from public.orders where id=before_order_id and restaurant_id=r.id and customer_id=guest and session_id=visit_id;
    if not found then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  end if;
  -- Never add different currencies or lose integer precision in JSON.
  if exists(select 1 from public.orders where restaurant_id=r.id and customer_id=guest and session_id=visit_id and currency<>r.currency) then
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
    from public.orders where restaurant_id=r.id and customer_id=guest and session_id=visit_id;
  if exists(select 1 from jsonb_each_text(amounts) a where a.value::numeric>9007199254740991) then
    raise exception using errcode='P0001',message='HISTORY_UNAVAILABLE';
  end if;
  with page as (
    select o.* from public.orders o where o.restaurant_id=r.id and o.customer_id=guest and o.session_id=visit_id
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
    'totals',amounts,'orders',history,'nextCursor',next_cursor,'scope','visit',
    'visit',case when visit_id is not null then jsonb_build_object('id',visit_id,'tableLabel',visit->>'tableLabel','openedAt',visit->>'openedAt') else null end);
end;
$$;
revoke all on function public.get_guest_visit_order_history(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_guest_visit_order_history(text,uuid,uuid) to authenticated;
comment on function public.get_guest_table_bill(text,uuid) is 'Approved active participants share itemized dish values for one visit, never guest identities or private receipts. Not a payment balance.';
comment on function public.get_guest_visit_order_history(text,uuid,uuid) is 'Current-visit guest-owned receipts and trusted totals. A QR selects context but never authenticates or establishes participation.';
