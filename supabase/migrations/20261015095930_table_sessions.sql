begin;

create table public.table_sessions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  table_id uuid not null,
  table_label text not null check(length(btrim(table_label)) between 1 and 60),
  currency text not null check(currency in ('EUR','USD','GBP')),
  status text not null default 'active' check(status in ('active','closed')),
  opened_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  unique(restaurant_id,id), unique(restaurant_id,table_id,id),
  foreign key(restaurant_id,table_id) references public.dining_tables(restaurant_id,id) on delete restrict,
  check ((status='active' and closed_at is null) or (status='closed' and closed_at is not null and closed_at>=opened_at))
);
create unique index table_sessions_one_active_idx on public.table_sessions(restaurant_id,table_id) where status='active';
create index table_sessions_history_idx on public.table_sessions(restaurant_id,opened_at desc,id desc);
-- Historical orders stay unassigned. Never infer a visit from dates or a QR.
alter table public.orders add column session_id uuid;
alter table public.orders add constraint orders_session_tenant_table_fk foreign key(restaurant_id,table_id,session_id)
  references public.table_sessions(restaurant_id,table_id,id) on delete restrict;
create index orders_session_idx on public.orders(restaurant_id,session_id,created_at desc,id desc) where session_id is not null;

create table private.session_participants (
  restaurant_id uuid not null,
  session_id uuid not null,
  guest_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default clock_timestamp(),
  authorized_at timestamptz,
  primary key(session_id,guest_id),
  foreign key(restaurant_id,session_id) references public.table_sessions(restaurant_id,id) on delete restrict
);
create index session_participants_guest_idx on private.session_participants(guest_id,restaurant_id,joined_at desc);
create table private.session_events (
  id uuid primary key default gen_random_uuid(), restaurant_id uuid not null, session_id uuid not null,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check(action in ('opened','closed','participant_authorized','bill_requested','bill_acknowledged')),
  occurred_at timestamptz not null default clock_timestamp(),
  foreign key(restaurant_id,session_id) references public.table_sessions(restaurant_id,id) on delete restrict
);
create index session_events_session_idx on private.session_events(restaurant_id,session_id,occurred_at);
create index session_events_rate_idx on private.session_events(actor_id,occurred_at) where action='bill_requested';
create table public.bill_requests (
  id uuid primary key default gen_random_uuid(), restaurant_id uuid not null, session_id uuid not null unique,
  status text not null default 'requested' check(status in ('requested','acknowledged','closed')),
  requested_at timestamptz not null default clock_timestamp(), acknowledged_at timestamptz, closed_at timestamptz,
  foreign key(restaurant_id,session_id) references public.table_sessions(restaurant_id,id) on delete restrict,
  check ((status='requested' and acknowledged_at is null and closed_at is null)
    or (status='acknowledged' and acknowledged_at is not null and closed_at is null)
    or (status='closed' and closed_at is not null))
);
create index bill_requests_restaurant_idx on public.bill_requests(restaurant_id,requested_at desc);

alter table public.table_sessions enable row level security;
alter table public.bill_requests enable row level security;
alter table private.session_participants enable row level security;
alter table private.session_events enable row level security;
revoke all on public.table_sessions,public.bill_requests,private.session_participants,private.session_events from public,anon,authenticated;
grant select on public.table_sessions,public.bill_requests to authenticated;

create function private.is_session_participant(target_session uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce(auth.jwt()->>'is_anonymous'='true' and auth.jwt()->>'sub'=auth.uid()::text,false)
    and exists(select 1 from private.session_participants where session_id=target_session and guest_id=auth.uid() and authorized_at is not null);
$$;
revoke all on function private.is_session_participant(uuid) from public,anon,authenticated;
grant execute on function private.is_session_participant(uuid) to authenticated;
-- Minimal session/request signal rows contain no guest or staff identities.
-- Authorized participants can receive closure events, but never another visit.
create policy sessions_read on public.table_sessions for select to authenticated
  using(private.is_member(restaurant_id) or private.is_session_participant(id));
create policy bill_requests_read on public.bill_requests for select to authenticated
  using(private.is_member(restaurant_id) or private.is_session_participant(session_id));

create function private.session_totals(target_session uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if exists(select 1 from public.orders o join public.table_sessions s on s.id=o.session_id where s.id=target_session and o.currency<>s.currency) then raise exception using errcode='P0001',message='UNAVAILABLE'; end if;
  select jsonb_build_object('orderValueMinor',coalesce(sum(total_minor) filter(where status<>'cancelled'),0),
    'confirmedMinor',coalesce(sum(total_minor) filter(where status in ('accepted','preparing','ready','served')),0),
    'pendingMinor',coalesce(sum(total_minor) filter(where status='pending'),0),
    'cancelledMinor',coalesce(sum(total_minor) filter(where status='cancelled'),0),
    'orderCount',count(*),'pendingCount',count(*) filter(where status='pending'),
    'confirmedCount',count(*) filter(where status in ('accepted','preparing','ready','served')),
    'cancelledCount',count(*) filter(where status='cancelled'),
    'unfinishedCount',count(*) filter(where status not in ('served','cancelled'))) into result
    from public.orders where session_id=target_session;
  if exists(select 1 from jsonb_each_text(result) e where e.value::numeric>9007199254740991) then
    raise exception using errcode='P0001',message='UNAVAILABLE';
  end if;
  return result;
end;
$$;
create function private.session_summary(target_session uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',s.id,'tableId',s.table_id,'tableLabel',s.table_label,'status',s.status,
    'currency',s.currency,'openedAt',s.opened_at,'closedAt',s.closed_at,'updatedAt',s.updated_at,'totals',private.session_totals(s.id),
    'request',(select jsonb_build_object('id',b.id,'status',b.status,'requestedAt',b.requested_at,'acknowledgedAt',b.acknowledged_at) from public.bill_requests b where b.session_id=s.id))
    from public.table_sessions s where s.id=target_session;
$$;

-- Keep the tested order implementation, its validations and replay semantics.
-- A narrow wrapper serializes the table lifecycle BEFORE catalog row locks.
alter function public.create_guest_order(text,uuid,jsonb,uuid,uuid) set schema private;
revoke all on function private.create_guest_order(text,uuid,jsonb,uuid,uuid) from public,anon,authenticated;
create function public.create_guest_order(restaurant_slug text,table_token uuid,items jsonb,idempotency_key uuid,review_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare guest uuid; rest uuid; t public.dining_tables%rowtype; s uuid; result jsonb;
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

-- Integrity remains enforced even for trusted administrative writes. Existing
-- legacy NULL session rows remain compatible; an attached order cannot move.
create function private.guard_order_session() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and old.session_id is not null and (new.session_id is distinct from old.session_id or new.table_id<>old.table_id or new.restaurant_id<>old.restaurant_id) then
    raise exception using errcode='P0001',message='SESSION_IMMUTABLE';
  end if;
  if new.session_id is not null and (tg_op='INSERT' or old.session_id is distinct from new.session_id) then
    perform 1 from public.table_sessions where id=new.session_id and restaurant_id=new.restaurant_id and table_id=new.table_id and currency=new.currency and status='active' for update;
    if not found then raise exception using errcode='P0001',message='SESSION_CLOSED'; end if;
  end if;
  return new;
end;
$$;
create trigger orders_session_guard before insert or update on public.orders for each row execute function private.guard_order_session();

create function private.order_session_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.session_id is not null then
    if tg_op='UPDATE' and old.status='pending' and new.status='accepted' and new.customer_id is not null then
      update private.session_participants set authorized_at=clock_timestamp() where session_id=new.session_id and guest_id=new.customer_id and authorized_at is null;
      if found then insert into private.session_events(restaurant_id,session_id,actor_id,action) values(new.restaurant_id,new.session_id,auth.uid(),'participant_authorized'); end if;
    end if;
    update public.table_sessions set updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=new.session_id;
  end if;
  return new;
end;
$$;
create trigger orders_session_changed after insert or update on public.orders for each row execute function private.order_session_changed();

create function public.get_guest_table_bill(restaurant_slug text,table_token uuid default null) returns jsonb
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
    result:=result||jsonb_build_object('totals',private.session_totals(s.id),
      'request',(select jsonb_build_object('id',b.id,'status',b.status,'requestedAt',b.requested_at,'acknowledgedAt',b.acknowledged_at) from public.bill_requests b where b.session_id=s.id));
  end if;
  return result;
end;
$$;

create function public.request_session_bill(restaurant_slug text,target_session uuid) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare guest uuid; s public.table_sessions%rowtype; existing uuid; result uuid;
begin
  guest:=private.require_order_guest();
  perform pg_advisory_xact_lock(hashtextextended('bill-guest:'||guest::text,0));
  select sessions.* into s from public.table_sessions sessions join public.restaurants r on r.id=sessions.restaurant_id
    where sessions.id=target_session and r.slug=restaurant_slug and private.is_session_participant(sessions.id);
  if not found then raise exception using errcode='P0001',message='PARTICIPATION_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('table-session:'||s.table_id::text,0));
  perform 1 from public.table_sessions where id=s.id and status='active' for update;
  if not found then raise exception using errcode='P0001',message='SESSION_CLOSED'; end if;
  select id into existing from public.bill_requests where session_id=s.id;
  if found then return existing; end if;
  if (select count(*) from private.session_events where actor_id=guest and action='bill_requested' and occurred_at>clock_timestamp()-interval '10 minutes')>=3 then
    raise exception using errcode='P0001',message='RATE_LIMITED';
  end if;
  insert into public.bill_requests(restaurant_id,session_id) values(s.restaurant_id,s.id) returning id into result;
  insert into private.session_events(restaurant_id,session_id,actor_id,action) values(s.restaurant_id,s.id,guest,'bill_requested');
  update public.table_sessions set updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=s.id;
  return result;
end;
$$;

create function public.manage_table_session(target_restaurant uuid,target_table uuid,operation text,target_session uuid default null) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; s public.table_sessions%rowtype; t public.dining_tables%rowtype;
begin
  actor:=private.require_staff_restaurant(target_restaurant);
  if operation is null or operation not in ('open','close','acknowledge') then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  select * into t from public.dining_tables where id=target_table and restaurant_id=target_restaurant;
  if not found then raise exception using errcode='P0001',message='TABLE_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('table-session:'||t.id::text,0));
  if operation='open' then
    if not t.is_active or target_session is not null then raise exception using errcode='P0001',message='TABLE_INVALID'; end if;
    select * into s from public.table_sessions where table_id=t.id and restaurant_id=target_restaurant and status='active';
    if found then return s.id; end if;
    insert into public.table_sessions(restaurant_id,table_id,table_label,currency) values(target_restaurant,t.id,t.label,(select currency from public.restaurants where id=target_restaurant)) returning * into s;
    insert into private.session_events(restaurant_id,session_id,actor_id,action) values(target_restaurant,s.id,actor,'opened');
    return s.id;
  end if;
  select * into s from public.table_sessions where id=target_session and restaurant_id=target_restaurant and table_id=t.id for update;
  if not found then raise exception using errcode='P0001',message='SESSION_NOT_FOUND'; end if;
  if operation='close' then
    if s.status='closed' then return s.id; end if;
    if exists(select 1 from public.orders where session_id=s.id and status not in ('served','cancelled')) then raise exception using errcode='P0001',message='ACTIVE_ORDERS'; end if;
    if exists(select 1 from public.bill_requests where session_id=s.id and status='requested') then raise exception using errcode='P0001',message='REQUEST_UNACKNOWLEDGED'; end if;
    update public.bill_requests set status='closed',closed_at=clock_timestamp() where session_id=s.id;
    update public.table_sessions set status='closed',closed_at=clock_timestamp(),updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=s.id;
    insert into private.session_events(restaurant_id,session_id,actor_id,action) values(target_restaurant,s.id,actor,'closed');
  else
    if s.status<>'active' then raise exception using errcode='P0001',message='SESSION_CLOSED'; end if;
    update public.bill_requests set status='acknowledged',acknowledged_at=clock_timestamp() where session_id=s.id and status='requested';
    if found then insert into private.session_events(restaurant_id,session_id,actor_id,action) values(target_restaurant,s.id,actor,'bill_acknowledged');
      update public.table_sessions set updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=s.id;
    elsif not exists(select 1 from public.bill_requests where session_id=s.id and status='acknowledged') then raise exception using errcode='P0001',message='REQUEST_NOT_FOUND'; end if;
  end if;
  return s.id;
end;
$$;

create function public.get_table_workspace(target_restaurant uuid,before_session uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r public.restaurants%rowtype; tables jsonb; history jsonb; requests jsonb; cursor_row public.table_sessions%rowtype; next_cursor uuid;
begin
  perform private.require_staff_restaurant(target_restaurant);
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
create function public.get_staff_session_orders(target_restaurant uuid,target_session uuid,before_order uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; cursor_row public.orders%rowtype; next_cursor uuid;
begin
  perform private.require_staff_restaurant(target_restaurant);
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

revoke all on function private.session_totals(uuid),private.session_summary(uuid),private.guard_order_session(),private.order_session_changed() from public,anon,authenticated;
revoke all on function public.create_guest_order(text,uuid,jsonb,uuid,uuid),public.get_guest_table_bill(text,uuid),public.request_session_bill(text,uuid),public.manage_table_session(uuid,uuid,text,uuid),public.get_table_workspace(uuid,uuid),public.get_staff_session_orders(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_guest_order(text,uuid,jsonb,uuid,uuid),public.get_guest_table_bill(text,uuid),public.request_session_bill(text,uuid),public.manage_table_session(uuid,uuid,text,uuid),public.get_table_workspace(uuid,uuid),public.get_staff_session_orders(uuid,uuid,uuid) to authenticated;
alter publication supabase_realtime add table public.table_sessions, public.bill_requests;
notify pgrst,'reload schema';
commit;
