begin;

-- Privileged implementation outside the Data API's exposed schemas.
-- Resolve ONE active table for the requested published restaurant.
create function private.resolve_table(restaurant_slug text, table_token uuid)
returns table (table_label text)
language sql stable security definer set search_path = '' as $$
  select t.label from public.dining_tables t
  join public.restaurants r on r.id = t.restaurant_id
  where r.slug = restaurant_slug and r.is_published
    and t.qr_token = table_token and t.is_active;
$$;
revoke all on function private.resolve_table(text, uuid) from public, anon, authenticated;
grant execute on function private.resolve_table(text, uuid) to anon, authenticated;

create function public.resolve_table(restaurant_slug text, table_token uuid)
returns table (table_label text)
language sql stable security invoker set search_path = '' as $$
  select table_label from private.resolve_table(restaurant_slug, table_token);
$$;
revoke all on function public.resolve_table(text, uuid) from public, anon, authenticated;
grant execute on function public.resolve_table(text, uuid) to anon, authenticated;
comment on function public.resolve_table(text, uuid) is
  'Resolve one QR token to a label. No token enumeration, customer identity, or order access.';
notify pgrst, 'reload schema';
commit;
