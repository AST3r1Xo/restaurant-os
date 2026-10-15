begin;
-- A quote from a previous visit must not become an order in a new visit.
-- Existing committed idempotent replays still return before this binding check.
alter table private.order_reviews add column bound_session_id uuid, add column observed_closed_session_id uuid;
alter table private.order_reviews add constraint order_reviews_session_fk
  foreign key(restaurant_id,bound_session_id) references public.table_sessions(restaurant_id,id) on delete restrict;
alter table private.order_reviews add constraint order_reviews_closed_session_fk
  foreign key(restaurant_id,observed_closed_session_id) references public.table_sessions(restaurant_id,id) on delete restrict;
alter function public.review_guest_order(text,uuid,jsonb) set schema private;
revoke all on function private.review_guest_order(text,uuid,jsonb) from public,anon,authenticated;
create function public.review_guest_order(restaurant_slug text,table_token uuid,items jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare guest uuid; t public.dining_tables%rowtype; result jsonb; active_session uuid; closed_session uuid;
begin
  guest:=private.require_order_guest();
  perform pg_advisory_xact_lock(hashtextextended('order-guest:'||guest::text,0));
  select tables.* into t from public.dining_tables tables join public.restaurants r on r.id=tables.restaurant_id
    where r.slug=restaurant_slug and tables.qr_token=table_token;
  if found then perform pg_advisory_xact_lock(hashtextextended('table-session:'||t.id::text,0)); end if;
  result:=private.review_guest_order(restaurant_slug,table_token,items);
  select id into active_session from public.table_sessions where restaurant_id=t.restaurant_id and table_id=t.id and status='active';
  select id into closed_session from public.table_sessions where restaurant_id=t.restaurant_id and table_id=t.id and status='closed' order by closed_at desc,id desc limit 1;
  update private.order_reviews set bound_session_id=active_session,observed_closed_session_id=closed_session where id=(result->>'reviewId')::uuid and guest_id=guest;
  return result;
end;
$$;
revoke all on function public.review_guest_order(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.review_guest_order(text,uuid,jsonb) to authenticated;
create or replace function public.create_guest_order(restaurant_slug text,table_token uuid,items jsonb,idempotency_key uuid,review_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare guest uuid; rest uuid; t public.dining_tables%rowtype; s uuid; result jsonb; review private.order_reviews%rowtype;
begin
  guest:=private.require_order_guest();
  perform pg_advisory_xact_lock(hashtextextended('order-guest:'||guest::text,0));
  select id into rest from public.restaurants where slug=restaurant_slug;
  -- Replays (including legacy/session-closed orders) must not start a visit,
  -- attach historical orders, or require the old QR to remain valid.
  if exists(select 1 from public.orders o where o.restaurant_id=rest and o.customer_id=guest and o.idempotency_key=create_guest_order.idempotency_key) then
    return private.create_guest_order(restaurant_slug,table_token,items,idempotency_key,review_id);
  end if;
  select * into t from public.dining_tables where restaurant_id=rest and qr_token=table_token;
  if found then perform pg_advisory_xact_lock(hashtextextended('table-session:'||t.id::text,0)); end if;
  result:=private.create_guest_order(restaurant_slug,table_token,items,idempotency_key,review_id);
  -- Validate the review's visit after the original validator has checked its
  -- identity/fingerprint/prices. Any provisional inserts roll back on failure.
  select * into review from private.order_reviews where id=review_id;
  if (review.bound_session_id is not null and not exists(select 1 from public.table_sessions where id=review.bound_session_id and status='active' and table_id=t.id and restaurant_id=rest))
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
  return result;
end;
$$;
notify pgrst,'reload schema';
commit;
