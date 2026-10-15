begin;
-- Workflow versions must reflect the actual update, rather than transaction
-- start: a staff request may wait on another employee's row lock.
create function private.set_order_updated_at() returns trigger
language plpgsql set search_path='' as $$
begin
  new.updated_at := greatest(clock_timestamp(),old.updated_at + interval '1 microsecond');
  return new;
end;
$$;
revoke all on function private.set_order_updated_at() from public,anon,authenticated;
create or replace trigger orders_updated_at before update on public.orders
for each row execute function private.set_order_updated_at();
create or replace function public.transition_order(target_restaurant uuid,target_order uuid,expected_status public.order_status,next_status public.order_status,reason text default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; o public.orders%rowtype; changed_at timestamptz; clean_reason text;
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
  changed_at := clock_timestamp();
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

notify pgrst,'reload schema';
commit;
