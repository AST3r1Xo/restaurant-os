begin;

-- A kitchen can confirm a ticket when marking it prepared, without separate
-- acceptance/start clicks. Keep legacy intermediate states compatible.
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
    (o.status='pending' and next_status in ('accepted','ready','cancelled')) or
    (o.status='accepted' and next_status in ('preparing','ready')) or
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
    accepted_at=case when o.status='pending' and next_status in ('accepted','preparing','ready') then changed_at else accepted_at end,
    -- Do not invent a cooking start time when the only action was "prepared".
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

-- Staff's first operational action is also their confirmation of this guest's
-- order. QR possession or submission alone still cannot authorize a shared bill.
create or replace function private.order_session_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.session_id is not null then
    if tg_op='UPDATE' and old.status='pending' and new.status in ('accepted','preparing','ready') and new.customer_id is not null then
      update private.session_participants set authorized_at=clock_timestamp()
        where session_id=new.session_id and guest_id=new.customer_id and authorized_at is null;
      if found then
        insert into private.session_events(restaurant_id,session_id,actor_id,action)
          values(new.restaurant_id,new.session_id,auth.uid(),'participant_authorized');
      end if;
    end if;
    update public.table_sessions set updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=new.session_id;
  end if;
  return new;
end;
$$;
revoke all on function private.order_session_changed() from public,anon,authenticated;
revoke all on function public.transition_order(uuid,uuid,public.order_status,public.order_status,text) from public,anon,authenticated;
grant execute on function public.transition_order(uuid,uuid,public.order_status,public.order_status,text) to authenticated;
notify pgrst,'reload schema';
commit;
