-- Development demo only. Stable entity IDs; QR tokens are generated securely.
-- Re-running this file never overwrites existing rows, prices, or table tokens.
begin;
insert into public.restaurants (id, slug, name, description, cover_image_url, is_published, is_accepting_orders)
values ('11111111-1111-4111-8111-111111111111', 'mesa', 'Casa Mesa', 'Seasonal, thoughtful dining in Lisbon.', '/images/restaurant.jpg', true, true)
on conflict do nothing;

insert into public.dining_tables (id, restaurant_id, label)
values ('22222222-2222-4222-8222-222222222221', '11111111-1111-4111-8111-111111111111', 'Table 04')
on conflict do nothing;

insert into public.menu_categories (id, restaurant_id, name, description, sort_order) values
('33333333-3333-4333-8333-333333333331', '11111111-1111-4111-8111-111111111111', 'To begin', 'A good meal starts with something to share.', 0),
('33333333-3333-4333-8333-333333333332', '11111111-1111-4111-8111-111111111111', 'From the kitchen', 'Seasonal ingredients. A little care. A lot of flavor.', 1),
('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'Something sweet', 'Leave a little room for a lovely finish.', 2),
('33333333-3333-4333-8333-333333333334', '11111111-1111-4111-8111-111111111111', 'In your glass', 'Something refreshing to accompany your meal.', 3)
on conflict do nothing;

insert into public.products (id, restaurant_id, category_id, name, description, price_minor, image_url, allergens, dietary_tags, sort_order) values
('44444444-4444-4444-8444-444444444441', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333331', 'Smoked salmon eggs', 'Poached eggs, smoked salmon, hollandaise & toasted brioche.', 1400, '/images/eggs.jpg', '{milk,wheat,egg,fish}', '{house-favorite,chef-selection}', 0),
('44444444-4444-4444-8444-444444444442', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333332', 'Basil & tomato pasta', 'Fresh pasta, slow-roasted tomatoes, basil & aged Parmesan.', 2200, '/images/pasta.jpg', '{milk,wheat,egg}', '{house-favorite,vegetarian}', 0),
('44444444-4444-4444-8444-444444444443', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333332', 'Seasonal garden bowl', 'Market greens, roasted vegetables, grains & lemon dressing.', 1800, '/images/salad.jpg', '{}', '{house-favorite,plant-based}', 1)
on conflict do nothing;

-- No pretend staff or guest identities. Provision real Auth users + memberships
-- through trusted admin tooling when authentication is implemented.

-- Increment 3 sample definitions. Existing product presentation and prices survive.
update public.products set ingredients = case id
 when '44444444-4444-4444-8444-444444444441' then array['Poached eggs','Smoked salmon','Hollandaise','Brioche']
 when '44444444-4444-4444-8444-444444444442' then array['Fresh pasta','Tomatoes','Basil','Parmesan']
 when '44444444-4444-4444-8444-444444444443' then array['Market greens','Roasted vegetables','Grains','Lemon dressing'] end
where restaurant_id='11111111-1111-4111-8111-111111111111'
 and id in ('44444444-4444-4444-8444-444444444441','44444444-4444-4444-8444-444444444442','44444444-4444-4444-8444-444444444443') and cardinality(ingredients)=0;

insert into public.product_modifier_groups(restaurant_id,product_id,name,description,selection_type,min_selections,max_selections,sort_order)
select p.restaurant_id,p.id,v.name,v.description,v.kind,v.minimum,v.maximum,v.position
from public.products p join (values
 ('44444444-4444-4444-8444-444444444441'::uuid,'Your bread','Choose your favorite base.','single',1,1,0),
 ('44444444-4444-4444-8444-444444444441'::uuid,'A little extra','Make it a little more yours.','multiple',0,2,1),
 ('44444444-4444-4444-8444-444444444442'::uuid,'Your sauce','A classic or a touch of heat.','single',1,1,0),
 ('44444444-4444-4444-8444-444444444442'::uuid,'Finishing touches','Optional additions, prepared with care.','multiple',0,2,1),
 ('44444444-4444-4444-8444-444444444443'::uuid,'Your dressing','Choose your finishing flavor.','single',1,1,0),
 ('44444444-4444-4444-8444-444444444443'::uuid,'Make it yours','A little more texture and flavor.','multiple',0,2,1)
) v(product_id,name,description,kind,minimum,maximum,position) on p.id=v.product_id
where p.restaurant_id='11111111-1111-4111-8111-111111111111'
on conflict (restaurant_id,product_id,name) do nothing;

insert into public.modifier_options(restaurant_id,group_id,name,price_adjustment_minor,sort_order)
select g.restaurant_id,g.id,v.name,v.price,v.position
from public.product_modifier_groups g join (values
 ('Your bread','Toasted brioche',0,0),('Your bread','Sourdough',0,1),
 ('A little extra','Avocado',250,0),('A little extra','Extra poached egg',200,1),('A little extra','No hollandaise',0,2),
 ('Your sauce','Tomato & basil',0,0),('Your sauce','Arrabbiata',0,1),
 ('Finishing touches','Extra Parmesan',150,0),('Finishing touches','Toasted pine nuts',200,1),('Finishing touches','No Parmesan',0,2),
 ('Your dressing','Lemon dressing',0,0),('Your dressing','Tahini dressing',0,1),
 ('Make it yours','Avocado',250,0),('Make it yours','Toasted seeds',150,1)
) v(group_name,name,price,position) on g.name=v.group_name
where g.restaurant_id='11111111-1111-4111-8111-111111111111'
 and g.product_id in ('44444444-4444-4444-8444-444444444441','44444444-4444-4444-8444-444444444442','44444444-4444-4444-8444-444444444443')
on conflict (restaurant_id,group_id,name) do nothing;

commit;
