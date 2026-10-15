begin;
-- Bound table-rate checks to recent orders instead of scanning table history.
create index orders_table_recent_idx on public.orders(restaurant_id,table_id,created_at desc);
commit;
