begin;
-- Guest identities never become staff solely through a provisioned membership.
-- Permanent staff Auth keeps the existing membership/RLS authorization model.
create or replace function private.is_member(target_restaurant uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt()->>'is_anonymous','false')='false' and exists (
    select 1 from public.restaurant_members m
    where m.restaurant_id=target_restaurant and m.user_id=(select auth.uid())
  );
$$;
create or replace function private.can_manage(target_restaurant uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt()->>'is_anonymous','false')='false' and exists (
    select 1 from public.restaurant_members m
    where m.restaurant_id=target_restaurant and m.user_id=(select auth.uid())
      and m.role in ('owner','manager')
  );
$$;
-- Supabase Studio may provision this event-trigger helper outside app migrations.
-- Event triggers still run for their trusted owner; no public RPC grant is needed.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public,anon,authenticated';
  end if;
end;
$$;
commit;
