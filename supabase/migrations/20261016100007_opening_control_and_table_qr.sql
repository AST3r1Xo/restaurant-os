begin;
-- One manual operational state: reuse the trusted order-acceptance flag.
alter table public.restaurants add column opening_hours text not null default '' check(length(opening_hours)<=1000);
comment on column public.restaurants.opening_hours is 'Public opening-hours display text in the restaurant local timezone. Informational only; manual is_accepting_orders is authoritative until scheduling is implemented.';

create function public.set_restaurant_open(target_restaurant uuid,expected_open boolean,next_open boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.restaurants%rowtype;
begin
 perform private.require_menu_manager(target_restaurant);
 if expected_open is null or next_open is null then raise exception using errcode='P0001',message='MENU_INVALID'; end if;
 select * into r from public.restaurants where id=target_restaurant for update;
 if r.is_accepting_orders is distinct from expected_open then raise exception using errcode='P0001',message='MENU_CONFLICT'; end if;
 update public.restaurants set is_accepting_orders=next_open where id=r.id returning * into r;
 return jsonb_build_object('isOpen',r.is_accepting_orders,'updatedAt',r.updated_at);
end $$;

-- Also protects staff-created visits. Locking the restaurant serializes opening
-- and closing with new sessions and the existing trusted order-price transaction.
create function private.require_open_session() returns trigger
language plpgsql security definer set search_path='' as $$
declare opened boolean;
begin
 if new.status='active' then
  select is_accepting_orders into opened from public.restaurants where id=new.restaurant_id for share;
  if opened is distinct from true then raise exception using errcode='P0001',message='RESTAURANT_UNAVAILABLE'; end if;
 end if;
 return new;
end $$;
revoke all on function private.require_open_session() from public,anon,authenticated;
create trigger table_session_opening_guard before insert on public.table_sessions for each row execute function private.require_open_session();

-- Staff need labels/availability, never the printable bearer identifiers.
revoke select,insert,update,delete on public.dining_tables from authenticated;
grant select(id,restaurant_id,label,is_active,created_at,updated_at,visit_key) on public.dining_tables to authenticated;
grant insert(id,restaurant_id,label,is_active),update(label,is_active) on public.dining_tables to authenticated;

create function public.get_table_qr_codes(target_restaurant uuid)
returns table(id uuid,label text,qr_token uuid,is_active boolean,updated_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
 perform private.require_menu_manager(target_restaurant);
 return query select t.id,t.label,t.qr_token,t.is_active,t.updated_at from public.dining_tables t where t.restaurant_id=target_restaurant order by t.label,t.id;
end $$;

create function public.rotate_table_qr(target_restaurant uuid,target_table uuid,expected_version timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare t public.dining_tables%rowtype;
begin
 perform private.require_menu_manager(target_restaurant);
 perform pg_advisory_xact_lock(hashtextextended('table-session:'||target_table::text,0));
 select * into t from public.dining_tables where restaurant_id=target_restaurant and id=target_table for update;
 if not found then raise exception using errcode='P0001',message='TABLE_INVALID'; end if;
 if t.updated_at is distinct from expected_version then raise exception using errcode='P0001',message='MENU_CONFLICT'; end if;
 if exists(select 1 from public.table_sessions where restaurant_id=target_restaurant and table_id=t.id and status='active') then raise exception using errcode='P0001',message='TABLE_OCCUPIED'; end if;
 update public.dining_tables set qr_token=gen_random_uuid() where id=t.id;
end $$;
revoke all on function public.set_restaurant_open(uuid,boolean,boolean),public.get_table_qr_codes(uuid),public.rotate_table_qr(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.set_restaurant_open(uuid,boolean,boolean),public.get_table_qr_codes(uuid),public.rotate_table_qr(uuid,uuid,timestamptz) to authenticated;

create or replace function public.save_restaurant_presentation(target_restaurant uuid,expected_version timestamptz,definition jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare r public.restaurants%rowtype; logo public.menu_media_assets%rowtype; cover public.menu_media_assets%rowtype;
begin
 perform private.require_menu_manager(target_restaurant);
 select * into r from public.restaurants where id=target_restaurant for update;
 if r.updated_at is distinct from expected_version then raise exception using errcode='P0001',message='MENU_CONFLICT'; end if;
 if length(btrim(definition->>'name')) not between 1 and 120 or length(coalesce(definition->>'description',''))>4000 or not exists(select 1 from pg_timezone_names where name=definition->>'timezone') or jsonb_typeof(definition->'is_published')<>'boolean' or jsonb_typeof(definition->'is_accepting_orders')<>'boolean' then raise exception using errcode='P0001',message='MENU_INVALID'; end if;
 if definition ? 'opening_hours' and (jsonb_typeof(definition->'opening_hours') is distinct from 'string' or length(definition->>'opening_hours')>1000) then raise exception using errcode='P0001',message='MENU_INVALID'; end if;
 logo:=private.menu_asset(target_restaurant,null,(definition->>'logo_asset_id')::uuid,'logo');
 cover:=private.menu_asset(target_restaurant,null,(definition->>'cover_asset_id')::uuid,'cover');
 update public.restaurants set opening_hours=case when definition ? 'opening_hours' then btrim(definition->>'opening_hours') else r.opening_hours end,name=btrim(definition->>'name'),description=coalesce(definition->>'description',''),timezone=definition->>'timezone',is_published=(definition->>'is_published')::boolean,is_accepting_orders=(definition->>'is_accepting_orders')::boolean,
 logo_asset_id=logo.id,cover_asset_id=cover.id,logo_url=case when logo.id is not null then logo.public_url when coalesce((definition->>'keep_legacy_logo')::boolean,false) and r.logo_asset_id is null then r.logo_url else null end,
 cover_image_url=case when cover.id is not null then cover.public_url when coalesce((definition->>'keep_legacy_cover')::boolean,false) and r.cover_asset_id is null then r.cover_image_url else null end where id=target_restaurant;
end $$;

commit;
