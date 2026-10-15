begin;
-- Keep managers' provenance and measurement work even before final review.
-- Public model_verified / model_ar_enabled gates are unchanged.
create or replace function public.save_menu_product(target_restaurant uuid,product_id uuid,expected_version timestamptz,definition jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare p public.products%rowtype; g jsonb; o jsonb; groups jsonb; n integer; pos integer:=0; opos integer;
 actor uuid; gid uuid; oid uuid; asset public.menu_media_assets%rowtype; glb public.menu_media_assets%rowtype;
 photo public.menu_media_assets%rowtype; usdz public.menu_media_assets%rowtype; poster public.menu_media_assets%rowtype;
 verified boolean; ar_enabled boolean; review jsonb; dims double precision[];
begin
 actor:=private.require_menu_manager(target_restaurant);
 if jsonb_typeof(definition)<>'object' or length(btrim(definition->>'name')) not between 1 and 160
 or length(coalesce(definition->>'description',''))>4000 or (definition->>'price_minor') !~ '^[0-9]{1,7}$'
 or (definition->>'price_minor')::integer>1000000 or definition->>'status' not in ('draft','published','archived')
 or jsonb_typeof(definition->'is_available')<>'boolean' then raise exception using errcode='P0001',message='MENU_INVALID'; end if;
 perform 1 from public.menu_categories where id=(definition->>'category_id')::uuid and restaurant_id=target_restaurant for share;
 if not found then raise exception using errcode='P0001',message='CATEGORY_INVALID'; end if;
 select * into p from public.products where id=product_id for update;
 if found then
 if p.restaurant_id<>target_restaurant or expected_version is distinct from p.updated_at then raise exception using errcode='P0001',message='MENU_CONFLICT'; end if;
 else
 if expected_version is not null then raise exception using errcode='P0001',message='MENU_CONFLICT'; end if;
 insert into public.products(id,restaurant_id,category_id,name,price_minor,is_published,is_available,sort_order) values(product_id,target_restaurant,(definition->>'category_id')::uuid,btrim(definition->>'name'),(definition->>'price_minor')::integer,false,false,coalesce((select max(sort_order)+1 from public.products where restaurant_id=target_restaurant),0));
 select * into p from public.products where id=product_id;
 end if;
 foreach n in array array[1,2,3] loop
 if jsonb_typeof(definition->(array['ingredients','allergens','dietary_tags'])[n])<>'array'
 or jsonb_array_length(definition->(array['ingredients','allergens','dietary_tags'])[n])>40
 or exists(select 1 from jsonb_array_elements(definition->(array['ingredients','allergens','dietary_tags'])[n]) v where jsonb_typeof(v)<>'string' or length(btrim(v#>>'{}')) not between 1 and 120) then raise exception using errcode='P0001',message='MENU_INVALID'; end if;
 end loop;
 photo:=private.menu_asset(target_restaurant,product_id,(definition->>'image_asset_id')::uuid,'photo');
 glb:=private.menu_asset(target_restaurant,product_id,(definition->>'model_asset_id')::uuid,'glb');
 usdz:=private.menu_asset(target_restaurant,product_id,(definition->>'model_usdz_asset_id')::uuid,'usdz');
 poster:=private.menu_asset(target_restaurant,product_id,(definition->>'model_poster_asset_id')::uuid,'poster');
 verified:=coalesce((definition->>'model_verified')::boolean,false); ar_enabled:=coalesce((definition->>'model_ar_enabled')::boolean,false); review:=definition->'review';
 dims:=glb.dimensions_m;
 if verified and (glb.id is null or dims is null or coalesce(length(btrim(review->>'license')),0) not between 2 and 1000 or coalesce(length(btrim(review->>'provenance')),0) not between 2 and 2000 or coalesce(length(btrim(review->>'measurement_notes')),0) not between 2 and 2000 or (review->>'confirmed') is distinct from 'true') then raise exception using errcode='P0001',message='MODEL_REVIEW_REQUIRED'; end if;
 if ar_enabled and not verified then raise exception using errcode='P0001',message='MODEL_REVIEW_REQUIRED'; end if;
 if length(coalesce(review->>'license',''))>1000 or length(coalesce(review->>'provenance',''))>2000 or length(coalesce(review->>'measurement_notes',''))>2000 then raise exception using errcode='P0001',message='MODEL_REVIEW_REQUIRED'; end if;
 if glb.id is not null then
 insert into private.product_model_reviews(restaurant_id,product_id,model_asset_id,license,provenance,measurement_notes,reviewed_by) values(target_restaurant,product_id,glb.id,coalesce(btrim(review->>'license'),''),coalesce(btrim(review->>'provenance'),''),coalesce(btrim(review->>'measurement_notes'),''),actor)
 on conflict on constraint product_model_reviews_pkey do update set model_asset_id=excluded.model_asset_id,license=excluded.license,provenance=excluded.provenance,measurement_notes=excluded.measurement_notes,reviewed_by=actor,reviewed_at=now();
 end if;
 update public.products set category_id=(definition->>'category_id')::uuid,name=btrim(definition->>'name'),description=coalesce(definition->>'description',''),price_minor=(definition->>'price_minor')::integer,
 ingredients=array(select jsonb_array_elements_text(definition->'ingredients')),allergens=array(select jsonb_array_elements_text(definition->'allergens')),dietary_tags=array(select jsonb_array_elements_text(definition->'dietary_tags')),
 is_published=definition->>'status'='published',archived_at=case when definition->>'status'='archived' then coalesce(p.archived_at,now()) else null end,is_available=(definition->>'is_available')::boolean and definition->>'status'<>'archived',
 image_asset_id=photo.id,image_url=case when photo.id is not null then photo.public_url when coalesce((definition->>'keep_legacy_image')::boolean,false) and p.image_asset_id is null then p.image_url else null end,
 model_asset_id=glb.id,model_glb_url=glb.public_url,model_usdz_asset_id=usdz.id,model_usdz_url=usdz.public_url,model_poster_asset_id=poster.id,model_poster_url=poster.public_url,model_dimensions_m=dims,model_verified=verified,model_ar_enabled=ar_enabled where id=product_id;
 groups:=definition->'groups';
 if jsonb_typeof(groups)<>'array' or jsonb_array_length(groups)>10 then raise exception using errcode='P0001',message='MODIFIERS_INVALID'; end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(groups))<>jsonb_array_length(groups) then raise exception using errcode='P0001',message='MODIFIERS_INVALID'; end if;
 -- Retain removed definitions and IDs. Snapshots in historical orders are never rewritten.
 update public.product_modifier_groups mg set is_active=false where mg.restaurant_id=target_restaurant and mg.product_id=save_menu_product.product_id;
 for g in select value from jsonb_array_elements(groups) loop
 gid:=(g->>'id')::uuid;
 if length(btrim(g->>'name')) not between 1 and 120 or length(coalesce(g->>'description',''))>1000 or g->>'selection_type' not in ('single','multiple')
 or (g->>'min_selections') !~ '^[0-9]{1,2}$' or (g->>'max_selections') !~ '^[0-9]{1,2}$'
 or jsonb_typeof(g->'is_active')<>'boolean' or jsonb_typeof(g->'options')<>'array' or jsonb_array_length(g->'options')>20
 or (g->>'min_selections')::int>(g->>'max_selections')::int or (g->>'max_selections')::int not between 1 and 20
 or (g->>'selection_type'='single' and (g->>'max_selections')::int<>1)
 or ((g->>'is_active')::boolean and (g->>'min_selections')::int>(select count(*) from jsonb_array_elements(g->'options') v where v->>'is_available'='true'))
 then raise exception using errcode='P0001',message='MODIFIERS_INVALID'; end if;
 if exists(select 1 from public.product_modifier_groups mg where mg.id=gid and (mg.restaurant_id<>target_restaurant or mg.product_id<>save_menu_product.product_id)) then raise exception using errcode='P0001',message='MODIFIERS_INVALID'; end if;
 insert into public.product_modifier_groups(id,restaurant_id,product_id,name,description,selection_type,min_selections,max_selections,sort_order,is_active) values(gid,target_restaurant,product_id,btrim(g->>'name'),coalesce(g->>'description',''),g->>'selection_type',(g->>'min_selections')::int,(g->>'max_selections')::int,pos,(g->>'is_active')::boolean)
 on conflict(id) do update set name=excluded.name,description=excluded.description,selection_type=excluded.selection_type,min_selections=excluded.min_selections,max_selections=excluded.max_selections,sort_order=excluded.sort_order,is_active=excluded.is_active;
 update public.modifier_options set is_available=false where restaurant_id=target_restaurant and group_id=gid;
 if (select count(distinct value->>'id') from jsonb_array_elements(g->'options'))<>jsonb_array_length(g->'options') then raise exception using errcode='P0001',message='MODIFIERS_INVALID'; end if;
 opos:=0;
 for o in select value from jsonb_array_elements(g->'options') loop
 oid:=(o->>'id')::uuid;
 if length(btrim(o->>'name')) not between 1 and 120 or (o->>'price_adjustment_minor') !~ '^[0-9]{1,7}$' or (o->>'price_adjustment_minor')::int>1000000 or jsonb_typeof(o->'is_available')<>'boolean' or exists(select 1 from public.modifier_options where id=oid and (restaurant_id<>target_restaurant or group_id<>gid)) then raise exception using errcode='P0001',message='MODIFIERS_INVALID'; end if;
 insert into public.modifier_options(id,restaurant_id,group_id,name,price_adjustment_minor,sort_order,is_available) values(oid,target_restaurant,gid,btrim(o->>'name'),(o->>'price_adjustment_minor')::int,opos,(o->>'is_available')::boolean)
 on conflict(id) do update set name=excluded.name,price_adjustment_minor=excluded.price_adjustment_minor,sort_order=excluded.sort_order,is_available=excluded.is_available;
 opos:=opos+1;
 end loop;
 pos:=pos+1;
 end loop;
 return product_id;
end $$;

notify pgrst,'reload schema';
commit;
