begin;
-- Permanent boundary: customers see only their own active dining visit.
-- Historical records stay in place and remain available to authorized staff.
alter table public.dining_tables add column visit_key uuid not null default gen_random_uuid();
alter table private.order_reviews add column visit_key uuid;

create function public.resolve_table_visit(restaurant_slug text,table_token uuid)
returns table(table_label text,visit_key uuid)
language sql stable security definer set search_path='' as $$
  select t.label,t.visit_key from public.dining_tables t join public.restaurants r on r.id=t.restaurant_id
  where r.slug=restaurant_slug and r.is_published and t.qr_token=table_token and t.is_active;
$$;
revoke all on function public.resolve_table_visit(text,uuid) from public,anon,authenticated;
grant execute on function public.resolve_table_visit(text,uuid) to anon,authenticated;
comment on function public.resolve_table_visit(text,uuid) is 'One table label and opaque current visit generation. No session history, participant identity or order access.';

create function private.rotate_table_visit() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.status='active' and new.status='closed' then
    update public.dining_tables set visit_key=gen_random_uuid() where id=new.table_id and restaurant_id=new.restaurant_id;
  end if;
  return new;
end;
$$;
revoke all on function private.rotate_table_visit() from public,anon,authenticated;
create trigger table_session_visit_closed after update of status on public.table_sessions
for each row execute function private.rotate_table_visit();

create function private.can_read_guest_order(target_restaurant uuid,target_session uuid,owner_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and owner_id=auth.uid()
    and (auth.jwt()->>'sub')=auth.uid()::text and (auth.jwt()->>'is_anonymous')='true'
    and exists(select 1 from public.table_sessions s join private.session_participants p on p.session_id=s.id and p.restaurant_id=s.restaurant_id
      where s.id=target_session and s.restaurant_id=target_restaurant and s.status='active' and p.guest_id=auth.uid());
$$;
revoke all on function private.can_read_guest_order(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.can_read_guest_order(uuid,uuid,uuid) to authenticated;
alter policy orders_read on public.orders using(private.is_member(restaurant_id) or private.can_read_guest_order(restaurant_id,session_id,customer_id));
alter policy order_items_read on public.order_items using(exists(
  select 1 from public.orders o where o.id=order_id and o.restaurant_id=order_items.restaurant_id));

create or replace function private.is_session_participant(target_session uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and (auth.jwt()->>'sub')=auth.uid()::text and (auth.jwt()->>'is_anonymous')='true'
    and exists(select 1 from private.session_participants p join public.table_sessions s on s.id=p.session_id and s.restaurant_id=p.restaurant_id
      where p.session_id=target_session and p.guest_id=auth.uid() and p.authorized_at is not null and s.status='active');
$$;

-- The internal creator needs a provisional receipt before session attachment.
-- Its snapshot helper has no API execution grant; all public reads check the visit.
alter function public.get_guest_order(text,uuid,uuid) set schema private;
revoke all on function private.get_guest_order(text,uuid,uuid) from public,anon,authenticated;
create function public.get_guest_order(restaurant_slug text,order_id uuid default null,idempotency_key uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare guest uuid; target uuid;
begin
  guest:=private.require_order_guest();
  select o.id into target from public.orders o join public.restaurants r on r.id=o.restaurant_id
    where r.slug=restaurant_slug and o.customer_id=guest and (order_id is null or o.id=order_id)
      and (get_guest_order.idempotency_key is null or o.idempotency_key=get_guest_order.idempotency_key)
      and (order_id is not null or get_guest_order.idempotency_key is not null)
      and private.can_read_guest_order(o.restaurant_id,o.session_id,o.customer_id);
  if target is null then return null; end if;
  return private.get_guest_order(restaurant_slug,target,null);
end;
$$;
revoke all on function public.get_guest_order(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_guest_order(text,uuid,uuid) to authenticated;

create or replace function private.create_guest_order(restaurant_slug text,table_token uuid,items jsonb,idempotency_key uuid,review_id uuid) returns jsonb
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
    return private.get_guest_order(restaurant_slug,existing.id,null);
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
  return private.get_guest_order(restaurant_slug,created,null);
end;
$$;

create function public.review_visit_order(restaurant_slug text,table_token uuid,items jsonb,visit_key uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare guest uuid; t public.dining_tables%rowtype; result jsonb; active_session uuid; closed_session uuid;
begin
  guest:=private.require_order_guest();
  perform pg_advisory_xact_lock(hashtextextended('order-guest:'||guest::text,0));
  select tables.* into t from public.dining_tables tables join public.restaurants r on r.id=tables.restaurant_id
    where r.slug=restaurant_slug and tables.qr_token=table_token;
  if found then
    perform pg_advisory_xact_lock(hashtextextended('table-session:'||t.id::text,0));
    select tables.* into t from public.dining_tables tables where tables.id=t.id;
  end if;
  if visit_key is null then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  result:=private.review_guest_order(restaurant_slug,table_token,items);
  if t.visit_key is distinct from review_visit_order.visit_key then raise exception using errcode='P0001',message='SESSION_CHANGED'; end if;
  select id into active_session from public.table_sessions where restaurant_id=t.restaurant_id and table_id=t.id and status='active';
  select id into closed_session from public.table_sessions where restaurant_id=t.restaurant_id and table_id=t.id and status='closed' order by closed_at desc,id desc limit 1;
  update private.order_reviews set bound_session_id=active_session,observed_closed_session_id=closed_session,visit_key=t.visit_key where id=(result->>'reviewId')::uuid and guest_id=guest;
  return result;
end;
$$;
create or replace function public.create_guest_order(restaurant_slug text,table_token uuid,items jsonb,idempotency_key uuid,review_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare guest uuid; rest uuid; t public.dining_tables%rowtype; s uuid; result jsonb; review private.order_reviews%rowtype; existing public.orders%rowtype;
begin
  guest:=private.require_order_guest();
  perform pg_advisory_xact_lock(hashtextextended('order-guest:'||guest::text,0));
  select id into rest from public.restaurants where slug=restaurant_slug;
  select * into existing from public.orders o where o.restaurant_id=rest and o.customer_id=guest and o.idempotency_key=create_guest_order.idempotency_key;
  if found then
    perform pg_advisory_xact_lock(hashtextextended('table-session:'||existing.table_id::text,0));
    -- Validate the original fingerprint, but never disclose a historical replay.
    result:=private.create_guest_order(restaurant_slug,table_token,items,idempotency_key,review_id);
    if not private.can_read_guest_order(existing.restaurant_id,existing.session_id,existing.customer_id) then
      raise exception using errcode='P0001',message='VISIT_ENDED';
    end if;
    return public.get_guest_order(restaurant_slug,existing.id,null);
  end if;
  select * into t from public.dining_tables where restaurant_id=rest and qr_token=table_token;
  if found then
    perform pg_advisory_xact_lock(hashtextextended('table-session:'||t.id::text,0));
    select tables.* into t from public.dining_tables tables where tables.id=t.id;
  end if;
  result:=private.create_guest_order(restaurant_slug,table_token,items,idempotency_key,review_id);
  -- Validate the review's visit after the original validator has checked its
  -- identity/fingerprint/prices. Any provisional inserts roll back on failure.
  select * into review from private.order_reviews where id=review_id;
  if review.visit_key is distinct from t.visit_key or (review.bound_session_id is not null and not exists(select 1 from public.table_sessions where id=review.bound_session_id and status='active' and table_id=t.id and restaurant_id=rest))
    or (review.bound_session_id is null and review.observed_closed_session_id is distinct from (select id from public.table_sessions where restaurant_id=rest and table_id=t.id and status='closed' order by closed_at desc,id desc limit 1)) then
    raise exception using errcode='P0001',message='SESSION_CHANGED';
  end if;
  select id into s from public.table_sessions where restaurant_id=rest and table_id=t.id and status='active';
  if not found then
    insert into public.table_sessions(restaurant_id,table_id,table_label,currency) values(rest,t.id,t.label,result->>'currency') returning id into s;
    insert into private.session_events(restaurant_id,session_id,actor_id,action) values(rest,s,guest,'opened');
  end if;
  update public.orders set session_id=s where id=(result->>'id')::uuid and customer_id=guest and restaurant_id=rest and session_id is null;
  insert into private.session_participants(restaurant_id,session_id,guest_id) values(rest,s,guest) on conflict do nothing;
  update public.table_sessions set updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=s;
  return public.get_guest_order(restaurant_slug,(result->>'id')::uuid,null);
end;
$$;
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
    where sessions.restaurant_id=rest and sessions.status='active' and (target_table is null or sessions.table_id=target_table)
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


create or replace function public.get_guest_order_progress(restaurant_slug text,order_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare guest uuid; result jsonb;
begin
  guest := private.require_order_guest();
  select jsonb_build_object('id',o.id,'restaurantId',o.restaurant_id,'status',o.status,'updatedAt',o.updated_at,'cancelReason',o.cancellation_reason)
    into result from public.orders o join public.restaurants r on r.id=o.restaurant_id
    where r.slug=restaurant_slug and o.id=order_id and o.customer_id=guest and private.can_read_guest_order(o.restaurant_id,o.session_id,o.customer_id);
  return result;
end;
$$;
create or replace function public.get_guest_visit_order_history(restaurant_slug text, table_token uuid default null, before_order_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare guest uuid; r public.restaurants%rowtype; cursor_order public.orders%rowtype;
  amounts jsonb; history jsonb; next_cursor uuid; visit jsonb; visit_id uuid;
begin
  guest := private.require_order_guest();
  if restaurant_slug is null or restaurant_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(restaurant_slug)>120 then
    raise exception using errcode='P0001',message='INVALID_REQUEST';
  end if;
  select * into r from public.restaurants where slug=restaurant_slug
    and (is_published or exists(select 1 from public.orders o where o.restaurant_id=restaurants.id and o.customer_id=guest and private.can_read_guest_order(o.restaurant_id,o.session_id,o.customer_id)));
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

-- Old clients cannot bypass visit-bound review creation.
revoke all on function public.review_guest_order(text,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.review_visit_order(text,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.review_visit_order(text,uuid,jsonb,uuid) to authenticated;
-- Keep the previous endpoint compatible only with the current visit. No archive API.
create or replace function public.get_guest_order_history(restaurant_slug text,before_order_id uuid default null) returns jsonb
language sql stable security definer set search_path='' as $$
  select public.get_guest_visit_order_history(restaurant_slug,null,before_order_id);
$$;
comment on function public.get_guest_order_history(text,uuid) is 'Compatibility endpoint: active visit only. Historical customer access is permanently prohibited.';
comment on function public.get_guest_order(text,uuid,uuid) is 'Own active-visit receipt only. Closed and unassigned orders are staff-only, including idempotency recovery.';
notify pgrst,'reload schema';
commit;
