begin;
-- Development demonstration configuration; reuse labels/IDs/tokens and retain
-- all orders, visits and inactive test tables. Never displace an occupied table.
do $$
declare r uuid;
begin
 -- This is the stable development seed identity, not an arbitrary restaurant
 -- that happens to share the demonstration slug in another environment.
 select id into r from public.restaurants where slug='mesa' and id='11111111-1111-4111-8111-111111111111' for update;
 if r is null then return; end if;
 if exists(select 1 from public.dining_tables t join public.table_sessions s on s.table_id=t.id and s.restaurant_id=t.restaurant_id
   where t.restaurant_id=r and t.label not in('Table 01','Table 02','Table 03','Table 04','Table 05') and s.status='active') then
  raise exception 'Casa Mesa has an occupied extra table; finish its service before configuring five demonstration tables';
 end if;
 insert into public.dining_tables(restaurant_id,label)
 select r,'Table '||lpad(n::text,2,'0') from generate_series(1,5) n on conflict(restaurant_id,label) do nothing;
 update public.dining_tables set is_active=(label in('Table 01','Table 02','Table 03','Table 04','Table 05')) where restaurant_id=r
   and is_active is distinct from (label in('Table 01','Table 02','Table 03','Table 04','Table 05'));
end $$;
commit;
