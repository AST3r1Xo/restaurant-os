begin;
-- All catalog writes go through manager-authorized, transactional functions.
alter table public.products add column is_published boolean not null default true,
 add column archived_at timestamptz,
 add column model_verified boolean not null default false,
 add column model_ar_enabled boolean not null default false,
 add constraint products_ar_ready check (not model_ar_enabled or (model_verified and model_glb_url is not null and model_dimensions_m is not null));

create index products_published_menu_idx on public.products(restaurant_id,category_id,sort_order,id) where is_published and is_available and archived_at is null;

create table public.menu_media_assets (
 id uuid primary key, restaurant_id uuid not null references public.restaurants(id), product_id uuid,
 kind text not null check(kind in ('photo','poster','glb','usdz','logo','cover')),
 object_path text not null unique, public_url text not null,
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'), byte_size integer not null check(byte_size between 1 and 4000000),
 content_type text not null, dimensions_m double precision[],
 state text not null default 'pending' check(state in ('pending','ready','deleting','deleted')),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 unique(restaurant_id,id), foreign key(restaurant_id,product_id) references public.products(restaurant_id,id),
 check((product_id is null) = (kind in ('logo','cover')))
);
alter table public.menu_media_assets enable row level security;
revoke all on public.menu_media_assets from public,anon,authenticated;
grant select on public.menu_media_assets to authenticated;
create policy media_manager_read on public.menu_media_assets for select to authenticated using(private.can_manage(restaurant_id));

alter table public.products add column image_asset_id uuid, add column model_asset_id uuid,
 add column model_usdz_asset_id uuid, add column model_poster_asset_id uuid,
 add constraint product_photo_asset foreign key(restaurant_id,image_asset_id) references public.menu_media_assets(restaurant_id,id),
 add constraint product_glb_asset foreign key(restaurant_id,model_asset_id) references public.menu_media_assets(restaurant_id,id),
 add constraint product_usdz_asset foreign key(restaurant_id,model_usdz_asset_id) references public.menu_media_assets(restaurant_id,id),
 add constraint product_poster_asset foreign key(restaurant_id,model_poster_asset_id) references public.menu_media_assets(restaurant_id,id);
alter table public.restaurants add column logo_asset_id uuid, add column cover_asset_id uuid,
 add constraint restaurant_logo_asset foreign key(id,logo_asset_id) references public.menu_media_assets(restaurant_id,id),
 add constraint restaurant_cover_asset foreign key(id,cover_asset_id) references public.menu_media_assets(restaurant_id,id);
create table private.product_model_reviews (
 restaurant_id uuid not null, product_id uuid primary key, model_asset_id uuid not null,
 license text not null, provenance text not null, measurement_notes text not null,
 reviewed_by uuid not null references auth.users(id), reviewed_at timestamptz not null default now(),
 foreign key(restaurant_id,product_id) references public.products(restaurant_id,id),
 foreign key(restaurant_id,model_asset_id) references public.menu_media_assets(restaurant_id,id)
);
alter table private.product_model_reviews enable row level security;
revoke all on private.product_model_reviews from public,anon,authenticated;

revoke insert,update,delete on public.products,public.menu_categories,public.product_modifier_groups,public.modifier_options from authenticated;
revoke update on public.restaurants from authenticated;
revoke update(name,description,logo_url,cover_image_url,timezone,is_published,is_accepting_orders) on public.restaurants from authenticated;
-- FOR ALL manager policies also permit SELECT; replace them after removing DML.
drop policy products_manage on public.products;
drop policy categories_manage on public.menu_categories;
drop policy modifier_groups_manage on public.product_modifier_groups;
drop policy modifier_options_manage on public.modifier_options;
drop policy products_read on public.products;
create policy products_read on public.products for select to anon,authenticated using (
 private.is_member(restaurant_id) or (is_published and archived_at is null and is_available and exists(
 select 1 from public.restaurants r where r.id=restaurant_id and r.is_published) and exists(
 select 1 from public.menu_categories c where c.id=category_id and c.restaurant_id=products.restaurant_id and c.is_active)));

create function private.require_menu_manager(r uuid) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid;
begin
 actor:=private.require_staff_restaurant(r);
 if not private.can_manage(r) then raise exception using errcode='P0001',message='MANAGER_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('menu:'||r::text,0));
 return actor;
end $$;
revoke all on function private.require_menu_manager(uuid) from public,anon,authenticated;

create function public.menu_workspace(target_restaurant uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
 perform private.require_menu_manager(target_restaurant);
 return jsonb_build_object(
 'restaurant',(select to_jsonb(r) from public.restaurants r where id=target_restaurant),
 'categories',coalesce((select jsonb_agg(to_jsonb(c) order by sort_order,id) from public.menu_categories c where restaurant_id=target_restaurant),'[]'::jsonb),
 'products',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('review',(select to_jsonb(v) from private.product_model_reviews v where v.product_id=p.id),
 'groups',coalesce((select jsonb_agg(to_jsonb(g)||jsonb_build_object('options',coalesce((select jsonb_agg(to_jsonb(o) order by sort_order,id) from public.modifier_options o where o.restaurant_id=target_restaurant and o.group_id=g.id),'[]'::jsonb)) order by g.sort_order,g.id) from public.product_modifier_groups g where g.restaurant_id=target_restaurant and g.product_id=p.id),'[]'::jsonb)) order by p.sort_order,p.id) from public.products p where p.restaurant_id=target_restaurant),'[]'::jsonb),
 'assets',coalesce((select jsonb_agg(to_jsonb(a) order by created_at desc) from public.menu_media_assets a where restaurant_id=target_restaurant and state<>'deleted'),'[]'::jsonb));
end $$;

create function private.menu_asset(r uuid,p uuid,a uuid,k text) returns public.menu_media_assets
language plpgsql security definer set search_path='' as $$
declare asset public.menu_media_assets%rowtype;
begin
 if a is null then return null; end if;
 select * into asset from public.menu_media_assets where id=a and restaurant_id=r and product_id is not distinct from p and kind=k and state='ready' for share;
 if not found then raise exception using errcode='P0001',message='ASSET_INVALID'; end if;
 return asset;
end $$;
revoke all on function private.menu_asset(uuid,uuid,uuid,text) from public,anon,authenticated;

create function public.save_menu_category(target_restaurant uuid,category_id uuid,expected_version timestamptz,definition jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.menu_categories%rowtype;
begin
 perform private.require_menu_manager(target_restaurant);
 if jsonb_typeof(definition)<>'object' or length(btrim(definition->>'name')) not between 1 and 120 or length(coalesce(definition->>'description',''))>2000 or jsonb_typeof(definition->'is_active')<>'boolean' then raise exception using errcode='P0001',message='MENU_INVALID'; end if;
 select * into c from public.menu_categories where id=category_id for update;
 if found then
 if c.restaurant_id<>target_restaurant or expected_version is distinct from c.updated_at then raise exception using errcode='P0001',message='MENU_CONFLICT'; end if;
 update public.menu_categories set name=btrim(definition->>'name'),description=coalesce(definition->>'description',''),is_active=(definition->>'is_active')::boolean where id=c.id;
 else
 if expected_version is not null then raise exception using errcode='P0001',message='MENU_CONFLICT'; end if;
 insert into public.menu_categories(id,restaurant_id,name,description,is_active,sort_order) values(category_id,target_restaurant,btrim(definition->>'name'),coalesce(definition->>'description',''),(definition->>'is_active')::boolean,coalesce((select max(sort_order)+1 from public.menu_categories where restaurant_id=target_restaurant),0));
 end if;
 return category_id;
end $$;

create function public.save_menu_product(target_restaurant uuid,product_id uuid,expected_version timestamptz,definition jsonb) returns uuid
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
 if verified and (glb.id is null or dims is null or length(btrim(review->>'license')) not between 2 and 1000 or length(btrim(review->>'provenance')) not between 2 and 2000 or length(btrim(review->>'measurement_notes')) not between 2 and 2000 or (review->>'confirmed') is distinct from 'true') then raise exception using errcode='P0001',message='MODEL_REVIEW_REQUIRED'; end if;
 if ar_enabled and not verified then raise exception using errcode='P0001',message='MODEL_REVIEW_REQUIRED'; end if;
 if verified then
 insert into private.product_model_reviews(restaurant_id,product_id,model_asset_id,license,provenance,measurement_notes,reviewed_by) values(target_restaurant,product_id,glb.id,btrim(review->>'license'),btrim(review->>'provenance'),btrim(review->>'measurement_notes'),actor)
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

create function public.move_menu_entry(target_restaurant uuid,entry_id uuid,entry_kind text,direction integer) returns void
language plpgsql security definer set search_path='' as $$
declare ids uuid[]; idx integer; cat uuid; other_id uuid;
begin
 perform private.require_menu_manager(target_restaurant);
 if direction not in(-1,1) then raise exception using errcode='P0001',message='MENU_INVALID'; end if;
 if entry_kind='category' then
 perform id from public.menu_categories where restaurant_id=target_restaurant order by id for update;
 select array_agg(id order by sort_order,id) into ids from public.menu_categories where restaurant_id=target_restaurant;
 elsif entry_kind='product' then
 select category_id into cat from public.products where restaurant_id=target_restaurant and id=entry_id;
 perform id from public.products where restaurant_id=target_restaurant and category_id=cat order by id for update;
 select array_agg(id order by sort_order,id) into ids from public.products where restaurant_id=target_restaurant and category_id=cat and archived_at is null;
 else raise exception using errcode='P0001',message='MENU_INVALID'; end if;
 idx:=array_position(ids,entry_id);
 if idx is null then raise exception using errcode='P0001',message='MENU_INVALID'; end if;
 if idx+direction between 1 and cardinality(ids) then other_id:=ids[idx+direction]; ids[idx+direction]:=entry_id; ids[idx]:=other_id; end if;
 if entry_kind='category' then update public.menu_categories c set sort_order=v.ord-1 from unnest(ids) with ordinality v(id,ord) where c.id=v.id;
 else update public.products p set sort_order=v.ord-1 from unnest(ids) with ordinality v(id,ord) where p.id=v.id; end if;
end $$;

create function public.save_restaurant_presentation(target_restaurant uuid,expected_version timestamptz,definition jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare r public.restaurants%rowtype; logo public.menu_media_assets%rowtype; cover public.menu_media_assets%rowtype;
begin
 perform private.require_menu_manager(target_restaurant);
 select * into r from public.restaurants where id=target_restaurant for update;
 if r.updated_at is distinct from expected_version then raise exception using errcode='P0001',message='MENU_CONFLICT'; end if;
 if length(btrim(definition->>'name')) not between 1 and 120 or length(coalesce(definition->>'description',''))>4000 or not exists(select 1 from pg_timezone_names where name=definition->>'timezone') or jsonb_typeof(definition->'is_published')<>'boolean' or jsonb_typeof(definition->'is_accepting_orders')<>'boolean' then raise exception using errcode='P0001',message='MENU_INVALID'; end if;
 logo:=private.menu_asset(target_restaurant,null,(definition->>'logo_asset_id')::uuid,'logo');
 cover:=private.menu_asset(target_restaurant,null,(definition->>'cover_asset_id')::uuid,'cover');
 update public.restaurants set name=btrim(definition->>'name'),description=coalesce(definition->>'description',''),timezone=definition->>'timezone',is_published=(definition->>'is_published')::boolean,is_accepting_orders=(definition->>'is_accepting_orders')::boolean,
 logo_asset_id=logo.id,cover_asset_id=cover.id,logo_url=case when logo.id is not null then logo.public_url when coalesce((definition->>'keep_legacy_logo')::boolean,false) and r.logo_asset_id is null then r.logo_url else null end,
 cover_image_url=case when cover.id is not null then cover.public_url when coalesce((definition->>'keep_legacy_cover')::boolean,false) and r.cover_asset_id is null then r.cover_image_url else null end where id=target_restaurant;
end $$;

-- Only the trusted upload gateway can attest validated bytes. The actor comes
-- from server-verified Auth; normal clients cannot execute this service function.
create function public.register_menu_media(actor uuid,target_restaurant uuid,target_product uuid,asset_id uuid,asset_kind text,metadata jsonb,make_ready boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.menu_media_assets%rowtype; path text; ext text;
begin
 perform 1 from public.restaurant_members where restaurant_id=target_restaurant and user_id=actor and role in('owner','manager') for share;
 if not found then raise exception using errcode='P0001',message='MANAGER_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('media:'||actor::text,0));
 if target_product is not null then perform 1 from public.products where restaurant_id=target_restaurant and id=target_product; if not found then raise exception using errcode='P0001',message='MENU_INVALID'; end if; end if;
 ext:=case asset_kind when 'glb' then 'glb' when 'usdz' then 'usdz' when 'photo' then 'webp' when 'poster' then 'webp' when 'cover' then 'webp' when 'logo' then 'webp' end;
 if ext is null or ((target_product is null) is distinct from (asset_kind in('logo','cover'))) then raise exception using errcode='P0001',message='ASSET_INVALID'; end if;
 path:='restaurants/'||target_restaurant::text||case when target_product is null then '/branding/' else '/products/'||target_product::text||case when ext in('glb','usdz') then '/models/' else '/images/' end end||asset_id::text||'.'||ext;
 select * into a from public.menu_media_assets where id=asset_id for update;
 if found then
 if a.restaurant_id<>target_restaurant or a.product_id is distinct from target_product or a.kind<>asset_kind or a.sha256 is distinct from metadata->>'sha256' or a.state in('deleting','deleted') then raise exception using errcode='P0001',message='ASSET_INVALID'; end if;
 else
 if (select count(*) from public.menu_media_assets where created_by=actor and created_at>now()-interval '1 hour')>=40 then raise exception using errcode='P0001',message='UPLOAD_RATE_LIMIT'; end if;
 insert into public.menu_media_assets(id,restaurant_id,product_id,kind,object_path,public_url,sha256,byte_size,content_type,dimensions_m,created_by) values(asset_id,target_restaurant,target_product,asset_kind,path,(metadata->>'public_base')||path,metadata->>'sha256',(metadata->>'byte_size')::int,metadata->>'content_type',case when asset_kind='glb' then array(select jsonb_array_elements_text(metadata->'dimensions_m'))::double precision[] else null end,actor) returning * into a;
 end if;
 if make_ready then update public.menu_media_assets set state='ready' where id=asset_id returning * into a; end if;
 return to_jsonb(a);
end $$;

create function public.retire_menu_media(target_restaurant uuid,asset_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.menu_media_assets%rowtype;
begin
 perform private.require_menu_manager(target_restaurant);
 select * into a from public.menu_media_assets where id=asset_id and restaurant_id=target_restaurant for update;
 if not found then raise exception using errcode='P0001',message='ASSET_INVALID'; end if;
 if exists(select 1 from public.products where restaurant_id=target_restaurant and (image_asset_id=asset_id or model_asset_id=asset_id or model_usdz_asset_id=asset_id or model_poster_asset_id=asset_id)) or exists(select 1 from public.restaurants where id=target_restaurant and (logo_asset_id=asset_id or cover_asset_id=asset_id)) then raise exception using errcode='P0001',message='ASSET_IN_USE'; end if;
 update public.menu_media_assets set state='deleting' where id=asset_id returning * into a;
 return to_jsonb(a);
end $$;

revoke all on function public.menu_workspace(uuid),public.save_menu_category(uuid,uuid,timestamptz,jsonb),public.save_menu_product(uuid,uuid,timestamptz,jsonb),public.move_menu_entry(uuid,uuid,text,integer),public.save_restaurant_presentation(uuid,timestamptz,jsonb),public.retire_menu_media(uuid,uuid) from public,anon,authenticated;
grant execute on function public.menu_workspace(uuid),public.save_menu_category(uuid,uuid,timestamptz,jsonb),public.save_menu_product(uuid,uuid,timestamptz,jsonb),public.move_menu_entry(uuid,uuid,text,integer),public.save_restaurant_presentation(uuid,timestamptz,jsonb),public.retire_menu_media(uuid,uuid) to authenticated;
revoke all on function public.register_menu_media(uuid,uuid,uuid,uuid,text,jsonb,boolean) from public,anon,authenticated;
-- Test harnesses omit Supabase's service role and Storage schema.
do $$ begin
 if exists(select 1 from pg_roles where rolname='service_role') then
 execute 'grant execute on function public.register_menu_media(uuid,uuid,uuid,uuid,text,jsonb,boolean) to service_role';
 execute 'grant select, update(state) on public.menu_media_assets to service_role';
 end if;
 if to_regclass('storage.objects') is not null then
 execute $policy$create policy restaurant_media_gateway_insert on storage.objects as restrictive for insert to anon,authenticated with check(bucket_id<>'restaurant-media')$policy$;
 execute $policy$create policy restaurant_media_gateway_update on storage.objects as restrictive for update to anon,authenticated using(bucket_id<>'restaurant-media') with check(bucket_id<>'restaurant-media')$policy$;
 execute $policy$create policy restaurant_media_gateway_delete on storage.objects as restrictive for delete to anon,authenticated using(bucket_id<>'restaurant-media')$policy$;
 end if;
end $$;

create or replace function private.build_order_snapshot(restaurant_slug text,table_token uuid,items jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare r public.restaurants%rowtype; t public.dining_tables%rowtype; p public.products%rowtype;
  line jsonb; result jsonb := '[]'; options jsonb; group_row public.product_modifier_groups%rowtype;
  selected_count integer; selected_total integer; unit_price bigint; line_total bigint; total bigint := 0;
begin
  select * into r from public.restaurants where slug=restaurant_slug for share;
  if not found or not r.is_published or not r.is_accepting_orders then
    raise exception using errcode='P0001',message='RESTAURANT_UNAVAILABLE';
  end if;
  select * into t from public.dining_tables where restaurant_id=r.id and qr_token=table_token and is_active for share;
  if not found then raise exception using errcode='P0001',message='TABLE_INVALID'; end if;
  perform c.id from public.menu_categories c where c.restaurant_id=r.id and c.id in (
    select category_id from public.products where restaurant_id=r.id and id in (select (value->>'productId')::uuid from jsonb_array_elements(items))
  ) order by c.id for share;
  perform p0.id from public.products p0 where p0.restaurant_id=r.id and p0.id in (
    select (value->>'productId')::uuid from jsonb_array_elements(items)
  ) order by p0.id for update;
  perform g.id from public.product_modifier_groups g where g.restaurant_id=r.id and g.product_id in (
    select (value->>'productId')::uuid from jsonb_array_elements(items)
  ) order by g.id for update;
  perform o.id from public.modifier_options o join public.product_modifier_groups g on g.id=o.group_id and g.restaurant_id=o.restaurant_id
    where o.restaurant_id=r.id and g.product_id in(select (value->>'productId')::uuid from jsonb_array_elements(items))
    order by o.id for share of o;
  for line in select value from jsonb_array_elements(items) loop
    select product.* into p from public.products product
    join public.menu_categories c on c.id=product.category_id and c.restaurant_id=product.restaurant_id
    where product.id=(line->>'productId')::uuid and product.restaurant_id=r.id and product.is_available and product.is_published and product.archived_at is null and c.is_active;
    if not found then raise exception using errcode='P0001',message='PRODUCT_UNAVAILABLE'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'groupId',g.id,'groupName',g.name,'name',o.name,'priceAdjustmentMinor',o.price_adjustment_minor)
      order by g.sort_order,g.id,o.sort_order,o.id),'[]'::jsonb),count(*) into options,selected_total
    from public.modifier_options o join public.product_modifier_groups g on g.id=o.group_id and g.restaurant_id=o.restaurant_id
    where o.restaurant_id=r.id and g.product_id=p.id and g.is_active and o.is_available
      and o.id in(select value::uuid from jsonb_array_elements_text(line->'optionIds'));
    if selected_total<>jsonb_array_length(line->'optionIds') then raise exception using errcode='P0001',message='OPTIONS_INVALID'; end if;
    for group_row in select * from public.product_modifier_groups where restaurant_id=r.id and product_id=p.id and is_active loop
      select count(*) into selected_count from public.modifier_options o where o.restaurant_id=r.id and o.group_id=group_row.id and o.is_available
        and o.id in(select value::uuid from jsonb_array_elements_text(line->'optionIds'));
      if selected_count<group_row.min_selections or selected_count>group_row.max_selections
         or (group_row.selection_type='single' and selected_count>1) then
        raise exception using errcode='P0001',message='OPTIONS_INVALID';
      end if;
    end loop;
    unit_price := p.price_minor::bigint + (select coalesce(sum((value->>'priceAdjustmentMinor')::bigint),0) from jsonb_array_elements(options));
    line_total := unit_price*(line->>'quantity')::integer;
    total := total+line_total;
    if unit_price>2147483647 or line_total>2147483647 or total>2147483647 then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
    result := result || jsonb_build_array(jsonb_build_object('productId',p.id,'productName',p.name,'quantity',(line->>'quantity')::integer,
      'basePriceMinor',p.price_minor,'unitPriceMinor',unit_price,'lineTotalMinor',line_total,'options',options));
  end loop;
  return jsonb_build_object('restaurant',jsonb_build_object('id',r.id,'slug',r.slug,'name',r.name),
    'table',jsonb_build_object('label',t.label),'currency',r.currency,'items',result,'totalMinor',total);
end;
$$;


notify pgrst,'reload schema';
commit;
