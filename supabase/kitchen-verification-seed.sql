-- Optional DEVELOPMENT-only isolation fixture. No orders or Auth users are
-- fabricated here. The live verification script submits real guest orders.
-- Repeatable; never overwrites existing rows or rotates an existing QR token.
begin;
insert into public.restaurants(id,slug,name,is_published,is_accepting_orders)
values('77777777-7777-4777-8777-777777777770','kitchen-isolation-qa','Kitchen Isolation QA',true,true) on conflict do nothing;
insert into public.dining_tables(id,restaurant_id,label)
values('77777777-7777-4777-8777-777777777771','77777777-7777-4777-8777-777777777770','QA Table') on conflict do nothing;
insert into public.menu_categories(id,restaurant_id,name)
values('77777777-7777-4777-8777-777777777772','77777777-7777-4777-8777-777777777770','QA Category') on conflict do nothing;
insert into public.products(id,restaurant_id,category_id,name,price_minor)
values('77777777-7777-4777-8777-777777777773','77777777-7777-4777-8777-777777777770','77777777-7777-4777-8777-777777777772','Isolation test dish',500) on conflict do nothing;
commit;
