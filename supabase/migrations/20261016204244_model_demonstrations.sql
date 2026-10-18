begin;
-- Explicit stock/development presentation is distinct from a human-reviewed
-- representation of a real restaurant portion. It never enables AR.
alter table public.products add column model_demo_enabled boolean not null default false;
alter table public.products add constraint products_model_demo_safety check(
 not model_demo_enabled or (model_asset_id is not null and model_dimensions_m is not null and not model_verified and not model_ar_enabled)
);
comment on column public.products.model_demo_enabled is 'Manager-authorized, publicly labelled 3D demonstration only; never a real-portion certification and never AR.';

create function private.invalidate_model_demonstration() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.model_demo_enabled and (
   new.model_asset_id is distinct from old.model_asset_id or
   new.model_glb_url is distinct from old.model_glb_url or
   new.model_dimensions_m is distinct from old.model_dimensions_m or
   new.model_verified or new.model_ar_enabled or
   not exists(select 1 from private.product_model_reviews r where r.restaurant_id=new.restaurant_id and r.product_id=new.id
    and r.model_asset_id=new.model_asset_id and length(btrim(r.license))>=2 and length(btrim(r.provenance))>=2)
 ) then new.model_demo_enabled:=false; end if;
 return new;
end $$;
revoke all on function private.invalidate_model_demonstration() from public,anon,authenticated;
create trigger products_invalidate_model_demonstration before update on public.products
 for each row execute function private.invalidate_model_demonstration();

create function public.set_model_demonstration(target_restaurant uuid,target_product uuid,expected_version timestamptz,enabled boolean,rights_confirmed boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid; p public.products%rowtype; asset public.menu_media_assets%rowtype; review private.product_model_reviews%rowtype;
begin
 actor:=private.require_menu_manager(target_restaurant);
 if enabled is null then raise exception using errcode='P0001',message='MENU_INVALID'; end if;
 select * into p from public.products where id=target_product and restaurant_id=target_restaurant for update;
 if not found then raise exception using errcode='P0001',message='PRODUCT_UNAVAILABLE'; end if;
 if p.updated_at is distinct from expected_version then raise exception using errcode='P0001',message='MENU_CONFLICT'; end if;
 if enabled then
  asset:=private.menu_asset(target_restaurant,p.id,p.model_asset_id,'glb');
  select * into review from private.product_model_reviews where restaurant_id=target_restaurant and product_id=p.id;
  if rights_confirmed is distinct from true or asset.id is null or asset.dimensions_m is null or p.archived_at is not null
   or review.model_asset_id is distinct from asset.id
   or coalesce(length(btrim(review.license)),0)<2 or coalesce(length(btrim(review.provenance)),0)<2
  then raise exception using errcode='P0001',message='MODEL_DEMO_RIGHTS_REQUIRED'; end if;
  update private.product_model_reviews set reviewed_by=actor,reviewed_at=now() where restaurant_id=target_restaurant and product_id=p.id;
 end if;
 update public.products set model_demo_enabled=enabled,
  model_verified=case when enabled then false else p.model_verified end,
  model_ar_enabled=case when enabled then false else p.model_ar_enabled end
 where id=p.id and restaurant_id=target_restaurant;
end $$;
revoke all on function public.set_model_demonstration(uuid,uuid,timestamptz,boolean,boolean) from public,anon,authenticated;
grant execute on function public.set_model_demonstration(uuid,uuid,timestamptz,boolean,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
