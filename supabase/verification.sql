-- Read-only catalog inspection for setup verification. Contains no credentials.
-- Execute through the project's authenticated MCP/SQL connection before applying
-- migrations. Does not select customer data, order contents, or table QR tokens.
select jsonb_build_object(
  'tables', (
    select jsonb_agg(jsonb_build_object(
      'name', c.relname,
      'rls_enabled', c.relrowsecurity,
      'columns', (
        select jsonb_agg(jsonb_build_object(
          'name', a.attname,
          'type', format_type(a.atttypid, a.atttypmod),
          'not_null', a.attnotnull,
          'default', pg_get_expr(d.adbin, d.adrelid),
          'generated', a.attgenerated
        ) order by a.attnum)
        from pg_attribute a
        left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
        where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      ),
      'constraints', (
        select jsonb_agg(jsonb_build_object(
          'name', con.conname, 'type', con.contype,
          'definition', pg_get_constraintdef(con.oid)
        ) order by con.conname)
        from pg_constraint con where con.conrelid = c.oid
      )
    ) order by c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname in (
      'restaurants', 'restaurant_members', 'dining_tables', 'menu_categories',
      'products', 'orders', 'order_items', 'product_modifier_groups', 'modifier_options', 'table_sessions', 'bill_requests'
    )
  ),
  'indexes', (
    select jsonb_agg(to_jsonb(i) order by i.indexname)
    from pg_indexes i where i.schemaname = 'public' and i.tablename in (
      'restaurants', 'restaurant_members', 'dining_tables', 'menu_categories',
      'products', 'orders', 'order_items', 'product_modifier_groups', 'modifier_options', 'table_sessions', 'bill_requests'
    )
  ),
  'policies', (
    select jsonb_agg(to_jsonb(p) order by p.tablename, p.policyname)
    from pg_policies p where p.schemaname = 'public' and p.tablename in (
      'restaurants', 'restaurant_members', 'dining_tables', 'menu_categories',
      'products', 'orders', 'order_items', 'product_modifier_groups', 'modifier_options', 'table_sessions', 'bill_requests'
    )
  ),
  'grants', (
    select jsonb_agg(to_jsonb(g) order by g.table_name, g.grantee, g.privilege_type)
    from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.grantee in ('anon', 'authenticated')
      and g.table_name in (
        'restaurants', 'restaurant_members', 'dining_tables', 'menu_categories',
        'products', 'orders', 'order_items', 'product_modifier_groups', 'modifier_options', 'table_sessions', 'bill_requests'
      )
  ),
  'functions', (
    select jsonb_agg(jsonb_build_object(
      'schema', n.nspname, 'name', p.proname,
      'security_definer', p.prosecdef, 'settings', p.proconfig,
      'definition', pg_get_functiondef(p.oid)
    ) order by n.nspname, p.proname)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'private' and p.proname in ('is_member', 'can_manage', 'resolve_table', 'require_order_guest', 'normalize_order_items', 'order_request_fingerprint', 'build_order_snapshot', 'require_staff_restaurant', 'require_staff_restaurant_read', 'is_session_participant', 'session_totals', 'session_summary', 'guard_order_session', 'order_session_changed', 'create_guest_order', 'review_guest_order'))
      or (n.nspname = 'public' and p.proname in ('set_updated_at', 'resolve_table', 'resolve_table_visit', 'review_visit_order', 'review_guest_order', 'create_guest_order', 'get_guest_order', 'get_kitchen_snapshot', 'transition_order', 'get_guest_order_progress', 'get_guest_order_history', 'get_guest_visit_order_history', 'get_guest_table_bill', 'request_session_bill', 'manage_table_session', 'get_table_workspace', 'get_staff_session_orders'))
  ),
  'realtime_tables', (
    select jsonb_agg(tablename order by tablename)
    from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename in ('orders', 'order_items', 'table_sessions', 'bill_requests')
  ),
  'private_reviews', (select jsonb_build_object('rls_enabled',c.relrowsecurity,'schema','private','name',c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname='order_reviews'),
  'private_status_audit', (select jsonb_build_object('rls_enabled',c.relrowsecurity,'schema','private','name',c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname='order_status_events'),
  'migration_history_exists', to_regclass('supabase_migrations.schema_migrations') is not null
) as schema_inspection;
