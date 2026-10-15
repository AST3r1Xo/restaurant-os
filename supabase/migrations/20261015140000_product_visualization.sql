begin;
-- Optional catalogue metadata. No order/session/auth changes or fixture backfill.
alter table public.products
  add column model_poster_url text,
  add column model_dimensions_m double precision[],
  add constraint products_model_dimensions check (
    model_dimensions_m is null or coalesce(
      array_ndims(model_dimensions_m)=1 and array_lower(model_dimensions_m,1)=1
      and array_length(model_dimensions_m,1)=3
      and array_position(model_dimensions_m,null) is null
      and model_dimensions_m[1] between 0.003 and 1.2
      and model_dimensions_m[2] between 0.003 and 1.2
      and model_dimensions_m[3] between 0.003 and 1.2, false)
  );
comment on column public.products.model_dimensions_m is 'Measured GLB bounding box [width,height,depth] in metres, after baked transforms. Required and checked against geometry before AR. Not a portion certification.';
comment on column public.products.model_poster_url is 'Optional optimized public poster in this restaurant/product asset folder. GLB/USDZ licensing and matching physical dimensions must be checked during onboarding.';
notify pgrst,'reload schema';
commit;
