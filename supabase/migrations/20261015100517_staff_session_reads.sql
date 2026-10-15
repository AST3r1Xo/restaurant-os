begin;
-- PostgREST executes STABLE RPCs in read-only transactions. Read authorization
-- checks membership in the same snapshot; mutations retain the locking guard.
create function private.require_staff_restaurant_read(target_restaurant uuid) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
  if actor is null or (auth.jwt()->>'is_anonymous') is distinct from 'false'
    or (auth.jwt()->>'sub') is distinct from actor::text then
    raise exception using errcode='P0001',message='STAFF_REQUIRED';
  end if;
  if not private.is_member(target_restaurant) then
    raise exception using errcode='P0001',message='STAFF_FORBIDDEN';
  end if;
  return actor;
end;
$$;
revoke all on function private.require_staff_restaurant_read(uuid) from public,anon,authenticated;
create or replace function public.get_table_workspace(target_restaurant uuid,before_session uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r public.restaurants%rowtype; tables jsonb; history jsonb; requests jsonb; cursor_row public.table_sessions%rowtype; next_cursor uuid;
begin
  perform private.require_staff_restaurant_read(target_restaurant);
  select * into r from public.restaurants where id=target_restaurant;
  if before_session is not null then
    select * into cursor_row from public.table_sessions where id=before_session and restaurant_id=target_restaurant and status='closed';
    if not found then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'label',t.label,'isActive',t.is_active,
    'session',(select private.session_summary(s.id) from public.table_sessions s where s.restaurant_id=target_restaurant and s.table_id=t.id and s.status='active')) order by t.label,t.id),'[]'::jsonb)
    into tables from public.dining_tables t where t.restaurant_id=target_restaurant;
  with page as(select s.* from public.table_sessions s where s.restaurant_id=target_restaurant and s.status='closed'
    and (before_session is null or (s.opened_at,s.id)<(cursor_row.opened_at,cursor_row.id)) order by s.opened_at desc,s.id desc limit 21),
    visible as(select * from page order by opened_at desc,id desc limit 20)
  select coalesce(jsonb_agg(private.session_summary(id) order by opened_at desc,id desc),'[]'::jsonb),
    case when (select count(*) from page)>20 then (select id from visible order by opened_at,id limit 1) else null end into history,next_cursor from visible;
  select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'sessionId',s.id,'tableId',s.table_id,'tableLabel',s.table_label,'requestedAt',b.requested_at) order by b.requested_at),'[]'::jsonb)
    into requests from public.bill_requests b join public.table_sessions s on s.id=b.session_id where b.restaurant_id=target_restaurant and b.status='requested' and s.status='active';
  return jsonb_build_object('restaurantId',r.id,'currency',r.currency,'timezone',r.timezone,'tables',tables,'history',history,'nextCursor',next_cursor,'requests',requests,'fetchedAt',statement_timestamp());
end;
$$;

create or replace function public.get_staff_session_orders(target_restaurant uuid,target_session uuid,before_order uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; cursor_row public.orders%rowtype; next_cursor uuid;
begin
  perform private.require_staff_restaurant_read(target_restaurant);
  perform 1 from public.table_sessions where id=target_session and restaurant_id=target_restaurant;
  if not found then raise exception using errcode='P0001',message='SESSION_NOT_FOUND'; end if;
  if before_order is not null then
    select * into cursor_row from public.orders where id=before_order and session_id=target_session and restaurant_id=target_restaurant;
    if not found then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  end if;
  with page as(select o.* from public.orders o where o.restaurant_id=target_restaurant and o.session_id=target_session
    and (before_order is null or (o.created_at,o.id)<(cursor_row.created_at,cursor_row.id)) order by created_at desc,id desc limit 21),
  visible as(select * from page order by created_at desc,id desc limit 20)
  select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'reference',o.order_code,'restaurantId',o.restaurant_id,
    'tableLabel',o.table_label,'status',o.status,'currency',o.currency,'totalMinor',o.total_minor,'createdAt',o.created_at,'updatedAt',o.updated_at,'notes',o.notes,'cancelReason',o.cancellation_reason,
    'items',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.product_name,'quantity',i.quantity,'unitPriceMinor',i.unit_price_minor,'lineTotalMinor',i.line_total_minor,'options',i.selected_options,'notes',i.notes) order by i.created_at,i.id),'[]'::jsonb) from public.order_items i where i.order_id=o.id and i.restaurant_id=target_restaurant)) order by o.created_at desc,o.id desc),'[]'::jsonb),
    case when (select count(*) from page)>20 then (select id from visible order by created_at,id limit 1) else null end into result,next_cursor from visible o;
  return jsonb_build_object('restaurantId',target_restaurant,'sessionId',target_session,'orders',result,'nextCursor',next_cursor,'fetchedAt',statement_timestamp());
end;
$$;
notify pgrst,'reload schema';
commit;
