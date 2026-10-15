import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
let demoToken;
let otherToken;
const ids = {
  restaurant: "11111111-1111-4111-8111-111111111111",
  table: "22222222-2222-4222-8222-222222222221",
  category: "33333333-3333-4333-8333-333333333331",
  product: "44444444-4444-4444-8444-444444444441",
  otherRestaurant: "55555555-5555-4555-8555-555555555555",
  otherTable: "66666666-6666-4666-8666-666666666666",
  otherCategory: "77777777-7777-4777-8777-777777777777",
  otherProduct: "88888888-8888-4888-8888-888888888888",
  staff: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  manager: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  guest: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  outsider: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  order: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  otherOrder: "ffffffff-ffff-4fff-8fff-ffffffffffff",
};

before(async () => {
  // Minimal Supabase Auth/roles contract; all migrations and RLS run in Postgres.
  // This does not emulate Auth APIs or the Realtime delivery service.
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
    $$;
    grant usage on schema public, auth to anon, authenticated;
    create publication supabase_realtime;
  `);
  const directory = new URL("../supabase/migrations/", import.meta.url);
  for (const name of (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await db.exec(await readFile(new URL(name, directory), "utf8"));
  }
  await db.exec(
    await readFile(new URL("../supabase/seed.sql", import.meta.url), "utf8"),
  );
  await db.query("insert into auth.users (id) values ($1), ($2), ($3), ($4)", [
    ids.staff,
    ids.manager,
    ids.guest,
    ids.outsider,
  ]);
  await db.query(
    "insert into public.restaurant_members (restaurant_id, user_id, role) values ($1, $2, 'staff'), ($1, $3, 'manager')",
    [ids.restaurant, ids.staff, ids.manager],
  );
  await db.query(
    "insert into public.restaurants (id, slug, name) values ($1, 'other', 'Other Restaurant')",
    [ids.otherRestaurant],
  );
  await db.query(
    "insert into public.dining_tables (id, restaurant_id, label) values ($1, $2, 'Other Table')",
    [ids.otherTable, ids.otherRestaurant],
  );
  await db.query(
    "insert into public.menu_categories (id, restaurant_id, name) values ($1, $2, 'Private category')",
    [ids.otherCategory, ids.otherRestaurant],
  );
  await db.query(
    "insert into public.products (id, restaurant_id, category_id, name, price_minor) values ($1, $2, $3, 'Private product', 1000)",
    [ids.otherProduct, ids.otherRestaurant, ids.otherCategory],
  );
  await db.query(
    "insert into public.orders (id, restaurant_id, table_id, customer_id, currency, subtotal_minor, total_minor) values ($1, $2, $3, $4, 'EUR', 2800, 2800), ($5, $6, $7, $8, 'EUR', 1000, 1000)",
    [
      ids.order,
      ids.restaurant,
      ids.table,
      ids.guest,
      ids.otherOrder,
      ids.otherRestaurant,
      ids.otherTable,
      ids.outsider,
    ],
  );
  await db.query(
    "insert into public.order_items (restaurant_id, order_id, product_id, product_name, unit_price_minor, quantity) values ($1, $2, $3, 'Smoked salmon eggs', 1400, 2), ($4, $5, $6, 'Private product', 1000, 1)",
    [
      ids.restaurant,
      ids.order,
      ids.product,
      ids.otherRestaurant,
      ids.otherOrder,
      ids.otherProduct,
    ],
  );
  const visit = (
    await db.query(
      "insert into table_sessions(restaurant_id,table_id,table_label,currency) values($1,$2,'Table 04','EUR') returning id",
      [ids.restaurant, ids.table],
    )
  ).rows[0].id;
  await db.query("update orders set session_id=$1 where id=$2", [
    visit,
    ids.order,
  ]);
  await db.query(
    "insert into private.session_participants(restaurant_id,session_id,guest_id) values($1,$2,$3)",
    [ids.restaurant, visit, ids.guest],
  );
  demoToken = (
    await db.query("select qr_token from public.dining_tables where id=$1", [
      ids.table,
    ])
  ).rows[0].qr_token;
  otherToken = (
    await db.query("select qr_token from public.dining_tables where id=$1", [
      ids.otherTable,
    ])
  ).rows[0].qr_token;
});

after(async () => {
  await db.close();
});

test("optional 3D metadata preserves existing products and accepts measured metre dimensions", async () => {
  await db.exec("begin");
  try {
    assert.equal(
      (
        await db.query(
          "select count(*)::int as n from public.products where model_dimensions_m is null",
        )
      ).rows[0].n,
      4,
    );
    await db.query(
      "update public.products set model_dimensions_m=$1,model_poster_url=$2 where id=$3",
      [
        [0.22, 0.05, 0.22],
        "/models/demo/dish/poster.webp",
        "44444444-4444-4444-8444-444444444441",
      ],
    );
    assert.deepEqual(
      (
        await db.query(
          "select model_dimensions_m from public.products where id=$1",
          ["44444444-4444-4444-8444-444444444441"],
        )
      ).rows[0].model_dimensions_m,
      [0.22, 0.05, 0.22],
    );
  } finally {
    await db.exec("rollback");
  }
});
test("3D geometry metadata rejects empty, incomplete, negative, oversized and non-finite measurements", async () => {
  for (const value of [
    [],
    [0.2],
    [0.2, 0.2],
    [0.2, 0, 0.2],
    [0.2, -1, 0.2],
    [2, 0.1, 0.2],
    [null, 0.1, 0.2],
    [NaN, 0.1, 0.2],
    [Infinity, 0.1, 0.2],
  ]) {
    await db.exec("begin");
    try {
      await assert.rejects(
        db.query(
          "update public.products set model_dimensions_m=$1 where id=$2",
          [value, "44444444-4444-4444-8444-444444444441"],
        ),
        /products_model_dimensions/,
      );
    } finally {
      await db.exec("rollback");
    }
  }
});
test("public 3D catalogue fields retain publication and tenant filtering through product RLS", async () => {
  await asIdentity("anon", null, async () => {
    const rows = (
      await db.query(
        "select restaurant_id,model_glb_url,model_usdz_url,model_poster_url,model_dimensions_m from public.products",
      )
    ).rows;
    assert.ok(rows.length > 0);
    assert.ok(rows.every((row) => row.restaurant_id === ids.restaurant));
    await assert.rejects(
      db.query(
        "update public.products set model_dimensions_m=array[0.2,0.1,0.2]",
      ),
      /permission denied/,
    );
  });
});

async function asIdentity(role, userId, callback) {
  assert.ok(["anon", "authenticated"].includes(role));
  await db.exec("begin");
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [
      userId ?? "",
    ]);
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({
        sub: userId,
        is_anonymous: userId === ids.guest || userId === ids.outsider,
      }),
    ]);
    return await callback();
  } finally {
    await db.exec("rollback");
  }
}

test("public menu reads exclude unpublished restaurants and their dishes", async () => {
  await asIdentity("anon", null, async () => {
    assert.equal(
      (await db.query("select * from public.restaurants")).rows.length,
      1,
    );
    assert.equal(
      (await db.query("select * from public.products")).rows.length,
      3,
    );
    assert.equal(
      (await db.query("select * from public.menu_categories")).rows.length,
      4,
    );
  });
});

test("public menus hide unavailable dishes and inactive categories", async () => {
  await db.exec("begin");
  try {
    await db.query(
      "update public.menu_categories set is_active = false where id = $1",
      [ids.category],
    );
    await db.query(
      "update public.products set is_available = false where id = '44444444-4444-4444-8444-444444444442'",
    );
    await db.exec("set local role anon");
    assert.equal(
      (await db.query("select * from public.products")).rows.length,
      1,
    );
  } finally {
    await db.exec("rollback");
  }
});

test("unauthenticated clients cannot enumerate QR tokens or orders", async () => {
  await assert.rejects(
    asIdentity("anon", null, () =>
      db.query("select qr_token from public.dining_tables"),
    ),
    /permission denied/,
  );
  await assert.rejects(
    asIdentity("anon", null, () => db.query("select * from public.orders")),
    /permission denied/,
  );
});

test("guest identities see only their own order and item snapshots", async () => {
  await asIdentity("authenticated", ids.guest, async () => {
    assert.deepEqual(
      (await db.query("select id from public.orders")).rows.map(
        (row) => row.id,
      ),
      [ids.order],
    );
    assert.equal(
      (await db.query("select * from public.order_items")).rows.length,
      1,
    );
    assert.equal(
      (await db.query("select * from public.dining_tables")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from public.restaurant_members")).rows.length,
      0,
    );
  });
});

test("a shared table does not expose another diner's orders", async () => {
  await db.exec("begin");
  try {
    await db.query(
      "insert into public.orders (restaurant_id, table_id, customer_id, currency, subtotal_minor, total_minor) values ($1, $2, $3, 'EUR', 1400, 1400)",
      [ids.restaurant, ids.table, ids.outsider],
    );
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [
      ids.guest,
    ]);
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: ids.guest, is_anonymous: true }),
    ]);
    assert.deepEqual(
      (await db.query("select id from public.orders")).rows.map(
        (row) => row.id,
      ),
      [ids.order],
    );
  } finally {
    await db.exec("rollback");
  }
});

test("staff can read their own unpublished catalog", async () => {
  await db.exec("begin");
  try {
    await db.query(
      "update public.restaurants set is_published = false where id = $1",
      [ids.restaurant],
    );
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [
      ids.staff,
    ]);
    assert.equal(
      (await db.query("select * from public.restaurants")).rows.length,
      1,
    );
    assert.equal(
      (await db.query("select * from public.products")).rows.length,
      3,
    );
  } finally {
    await db.exec("rollback");
  }
});

test("staff can read their restaurant queue without accessing another tenant", async () => {
  await asIdentity("authenticated", ids.staff, async () => {
    assert.equal(
      (await db.query("select * from public.dining_tables")).rows.length,
      1,
    );
    assert.equal(
      (await db.query("select * from public.orders")).rows.length,
      1,
    );
    assert.equal(
      (await db.query("select * from public.order_items")).rows.length,
      1,
    );
  });
});

test("guests cannot change order status or forge order totals", async () => {
  await assert.rejects(
    asIdentity("authenticated", ids.guest, () =>
      db.query("update public.orders set status='served' where id=$1", [
        ids.order,
      ]),
    ),
    /permission denied/,
  );
  await assert.rejects(
    asIdentity("authenticated", ids.staff, () =>
      db.query("update public.orders set status='served' where id=$1", [
        ids.order,
      ]),
    ),
    /permission denied/,
  );
  await assert.rejects(
    asIdentity("authenticated", ids.staff, () =>
      db.query("update public.orders set total_minor = 0 where id = $1", [
        ids.order,
      ]),
    ),
    /permission denied/,
  );
  await assert.rejects(
    asIdentity("authenticated", ids.guest, () =>
      db.query(
        "insert into public.orders (restaurant_id, table_id, currency, subtotal_minor, total_minor) values ($1, $2, 'EUR', 0, 0)",
        [ids.restaurant, ids.table],
      ),
    ),
    /permission denied/,
  );
  await assert.rejects(
    asIdentity("authenticated", ids.guest, () =>
      db.query("update public.order_items set unit_price_minor = 0"),
    ),
    /permission denied/,
  );
});

test("catalog writes require manager RPCs, even for managers", async () => {
  for (const user of [ids.staff, ids.outsider, ids.manager])
    await assert.rejects(
      asIdentity("authenticated", user, () =>
        db.query("update public.products set price_minor=1500 where id=$1", [
          ids.product,
        ]),
      ),
      /permission denied/,
    );
  await asIdentity("authenticated", ids.manager, async () => {
    assert.equal(
      (
        await db.query("select public.menu_workspace($1) as w", [
          ids.restaurant,
        ])
      ).rows[0].w.restaurant.id,
      ids.restaurant,
    );
  });
});

test("users cannot grant themselves staff membership", async () => {
  await assert.rejects(
    asIdentity("authenticated", ids.guest, () =>
      db.query(
        "insert into public.restaurant_members (restaurant_id, user_id, role) values ($1, $2, 'owner')",
        [ids.restaurant, ids.guest],
      ),
    ),
    /permission denied/,
  );
});

test("composite foreign keys reject cross-restaurant relationships", async () => {
  await assert.rejects(
    db.query(
      "insert into public.products (restaurant_id, category_id, name, price_minor) values ($1, $2, 'Invalid product', 100)",
      [ids.restaurant, ids.otherCategory],
    ),
    /foreign key/,
  );
  await assert.rejects(
    db.query(
      "insert into public.orders (restaurant_id, table_id, currency, subtotal_minor, total_minor) values ($1, $2, 'EUR', 100, 100)",
      [ids.restaurant, ids.otherTable],
    ),
    /foreign key/,
  );
  await assert.rejects(
    db.query(
      "insert into public.order_items (restaurant_id, order_id, product_id, product_name, unit_price_minor, quantity) values ($1, $2, $3, 'Invalid', 100, 1)",
      [ids.restaurant, ids.order, ids.otherProduct],
    ),
    /foreign key/,
  );
  await assert.rejects(
    db.query(
      "insert into public.order_items (restaurant_id, order_id, product_id, product_name, unit_price_minor, quantity) values ($1, $2, $3, 'Invalid', 100, 1)",
      [ids.restaurant, ids.otherOrder, ids.product],
    ),
    /foreign key/,
  );
});

test("money and quantity constraints reject invalid input", async () => {
  await assert.rejects(
    db.query("update public.products set price_minor = -1 where id = $1", [
      ids.product,
    ]),
    /check constraint/,
  );
  await assert.rejects(
    db.query("update public.order_items set quantity = 0"),
    /check constraint/,
  );
  await assert.rejects(
    db.query("update public.orders set total_minor = 1 where id = $1", [
      ids.order,
    ]),
    /check constraint/,
  );
  await assert.rejects(
    db.query("update public.order_items set selected_options = '{}'::jsonb"),
    /check constraint/,
  );
});

test("historical order items survive menu price/name edits", async () => {
  await asIdentity("authenticated", ids.manager, async () => {
    // Trusted fixture mutation; the dedicated admin suite exercises the manager RPC.
    await db.exec("reset role");
    await db.query(
      "update public.products set name = 'Renamed dish', price_minor = 9900 where id = $1",
      [ids.product],
    );
    const item = (
      await db.query(
        "select product_name, unit_price_minor, line_total_minor from public.order_items where order_id = $1",
        [ids.order],
      )
    ).rows[0];
    assert.deepEqual(item, {
      product_name: "Smoked salmon eggs",
      unit_price_minor: 1400,
      line_total_minor: 2800,
    });
  });
});

test("order tables are registered for Realtime publication", async () => {
  const { rows } = await db.query(
    "select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by tablename",
  );
  assert.deepEqual(
    rows.map((row) => row.tablename),
    ["bill_requests", "order_items", "orders", "table_sessions"],
  );
});

test("read-only setup inspection reports the expected schema and access policies", async () => {
  const sql = await readFile(
    new URL("../supabase/verification.sql", import.meta.url),
    "utf8",
  );
  const { rows } = await db.query(sql);
  const inspection = rows[0].schema_inspection;
  assert.equal(inspection.tables.length, 11);
  assert.ok(inspection.tables.every((table) => table.rls_enabled));
  assert.ok(
    inspection.policies.some((policy) => policy.policyname === "tables_read"),
  );
  assert.ok(
    inspection.indexes.some(
      (index) => index.indexname === "products_category_idx",
    ),
  );
  const products = inspection.tables.find((table) => table.name === "products");
  assert.ok(
    products.constraints.some(
      (constraint) =>
        constraint.type === "f" &&
        constraint.definition.includes("restaurant_id, category_id"),
    ),
  );
  assert.deepEqual(inspection.realtime_tables, [
    "bill_requests",
    "order_items",
    "orders",
    "table_sessions",
  ]);
});

test("QR RPC resolves one active table and exposes only its label to an anonymous visitor", async () => {
  await asIdentity("anon", null, async () => {
    assert.deepEqual(
      (
        await db.query("select * from public.resolve_table($1,$2)", [
          "mesa",
          demoToken,
        ])
      ).rows,
      [{ table_label: "Table 04" }],
    );
  });
});

test("QR RPC rejects cross-restaurant, unknown, and null token lookups", async () => {
  await db.exec("begin");
  try {
    await db.query(
      "update public.restaurants set is_published=true where id=$1",
      [ids.otherRestaurant],
    );
    await db.exec("set local role anon");
    assert.deepEqual(
      (
        await db.query("select * from public.resolve_table($1,$2)", [
          "other",
          otherToken,
        ])
      ).rows,
      [{ table_label: "Other Table" }],
    );
    for (const [slug, token] of [
      ["other", demoToken],
      ["mesa", otherToken],
      ["mesa", "99999999-9999-4999-8999-999999999999"],
      ["mesa", null],
      [null, demoToken],
    ]) {
      assert.deepEqual(
        (
          await db.query("select * from public.resolve_table($1,$2)", [
            slug,
            token,
          ])
        ).rows,
        [],
      );
    }
  } finally {
    await db.exec("rollback");
  }
});

test("deactivated tables and unpublished restaurants cannot resolve QR tokens", async () => {
  for (const sql of [
    "update public.dining_tables set is_active=false where label='Table 04'",
    "update public.restaurants set is_published=false where slug='mesa'",
  ]) {
    await db.exec("begin");
    try {
      await db.exec(sql);
      await db.exec("set local role anon");
      assert.deepEqual(
        (
          await db.query("select * from public.resolve_table($1,$2)", [
            "mesa",
            demoToken,
          ])
        ).rows,
        [],
      );
    } finally {
      await db.exec("rollback");
    }
  }
});

test("rotating a table token invalidates the original QR immediately", async () => {
  await db.exec("begin");
  try {
    const replacement = (
      await db.query(
        "update public.dining_tables set qr_token=gen_random_uuid() where id=$1 returning qr_token",
        [ids.table],
      )
    ).rows[0].qr_token;
    await db.exec("set local role anon");
    assert.deepEqual(
      (
        await db.query("select * from public.resolve_table($1,$2)", [
          "mesa",
          demoToken,
        ])
      ).rows,
      [],
    );
    assert.deepEqual(
      (
        await db.query("select * from public.resolve_table($1,$2)", [
          "mesa",
          replacement,
        ])
      ).rows,
      [{ table_label: "Table 04" }],
    );
  } finally {
    await db.exec("rollback");
  }
});

test("a successful QR resolution does not grant table or order access", async () => {
  await asIdentity("authenticated", ids.guest, async () => {
    assert.equal(
      (
        await db.query("select * from public.resolve_table($1,$2)", [
          "mesa",
          demoToken,
        ])
      ).rows.length,
      1,
    );
    assert.equal(
      (await db.query("select * from public.dining_tables")).rows.length,
      0,
    );
    assert.deepEqual(
      (await db.query("select id from public.orders")).rows.map(
        (row) => row.id,
      ),
      [ids.order],
    );
  });
});

test("demo seeds are repeatable without overwriting current menu or table state", async () => {
  await db.query("update public.products set price_minor=1500 where id=$1", [
    ids.product,
  ]);
  await db.exec(
    await readFile(new URL("../supabase/seed.sql", import.meta.url), "utf8"),
  );
  assert.equal(
    (
      await db.query("select price_minor from public.products where id=$1", [
        ids.product,
      ])
    ).rows[0].price_minor,
    1500,
  );
  assert.equal(
    (
      await db.query("select qr_token from public.dining_tables where id=$1", [
        ids.table,
      ])
    ).rows[0].qr_token,
    demoToken,
  );
  await db.query("update public.products set price_minor=1400 where id=$1", [
    ids.product,
  ]);
});

test("public customizations expose only active groups and available options of published products", async () => {
  await asIdentity("anon", null, async () => {
    assert.equal(
      (await db.query("select * from public.product_modifier_groups")).rows
        .length,
      6,
    );
    assert.equal(
      (await db.query("select * from public.modifier_options")).rows.length,
      14,
    );
  });
  for (const update of [
    "update public.restaurants set is_published=false where slug='mesa'",
    "update public.products set is_available=false where restaurant_id='11111111-1111-4111-8111-111111111111'",
    "update public.menu_categories set is_active=false where restaurant_id='11111111-1111-4111-8111-111111111111'",
    "update public.product_modifier_groups set is_active=false",
  ]) {
    await db.exec("begin");
    try {
      await db.exec(update);
      await db.exec("set local role anon");
      assert.equal(
        (await db.query("select * from public.product_modifier_groups")).rows
          .length,
        0,
      );
      assert.equal(
        (await db.query("select * from public.modifier_options")).rows.length,
        0,
      );
    } finally {
      await db.exec("rollback");
    }
  }
});
test("unavailable modifier options are private while required groups remain visible", async () => {
  await db.exec("begin");
  try {
    await db.exec("update public.modifier_options set is_available=false");
    await db.exec("set local role anon");
    assert.equal(
      (await db.query("select * from public.product_modifier_groups")).rows
        .length,
      6,
    );
    assert.equal(
      (await db.query("select * from public.modifier_options")).rows.length,
      0,
    );
  } finally {
    await db.exec("rollback");
  }
});
test("modifier foreign keys prohibit cross-restaurant product and group links", async () => {
  await assert.rejects(
    db.query(
      "insert into public.product_modifier_groups(restaurant_id,product_id,name) values($1,$2,'Bad group')",
      [ids.restaurant, ids.otherProduct],
    ),
    /foreign key/,
  );
  const group = (
    await db.query(
      "select id from public.product_modifier_groups where product_id=$1 limit 1",
      [ids.product],
    )
  ).rows[0].id;
  await assert.rejects(
    db.query(
      "insert into public.modifier_options(restaurant_id,group_id,name) values($1,$2,'Bad option')",
      [ids.otherRestaurant, group],
    ),
    /foreign key/,
  );
});
test("modifier changes use only authorized transactional manager functions", async () => {
  for (const user of [ids.staff, ids.guest, ids.outsider, ids.manager])
    await assert.rejects(
      asIdentity("authenticated", user, () =>
        db.query(
          "update public.modifier_options set price_adjustment_minor=500",
        ),
      ),
      /permission denied/,
    );
  for (const user of [ids.staff, ids.guest, ids.outsider])
    await assert.rejects(
      asIdentity("authenticated", user, () =>
        db.query("select public.menu_workspace($1)", [ids.restaurant]),
      ),
      /STAFF_REQUIRED|MANAGER_REQUIRED|STAFF_FORBIDDEN/,
    );
});
test("unpublished foreign modifiers remain hidden from public readers and other staff", async () => {
  await db.exec("begin");
  try {
    const group = (
      await db.query(
        "insert into public.product_modifier_groups(restaurant_id,product_id,name) values($1,$2,'Foreign group') returning id",
        [ids.otherRestaurant, ids.otherProduct],
      )
    ).rows[0].id;
    await db.query(
      "insert into public.modifier_options(restaurant_id,group_id,name) values($1,$2,'Foreign option')",
      [ids.otherRestaurant, group],
    );
    await db.exec("set local role anon");
    assert.equal(
      (
        await db.query(
          "select * from public.product_modifier_groups where restaurant_id=$1",
          [ids.otherRestaurant],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select * from public.modifier_options where restaurant_id=$1",
          [ids.otherRestaurant],
        )
      ).rows.length,
      0,
    );
    await db.exec("reset role; set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      ids.manager,
    ]);
    assert.equal(
      (
        await db.query(
          "select * from public.product_modifier_groups where restaurant_id=$1",
          [ids.otherRestaurant],
        )
      ).rows.length,
      0,
    );
    await db.exec("reset role");
    await db.query(
      "update public.restaurants set is_published=true where id=$1",
      [ids.otherRestaurant],
    );
    await db.exec("set local role anon");
    assert.equal(
      (
        await db.query(
          "select * from public.modifier_options where restaurant_id=$1",
          [ids.otherRestaurant],
        )
      ).rows.length,
      1,
    );
  } finally {
    await db.exec("rollback");
  }
});
test("database validates group cardinality, selection type and option prices", async () => {
  for (const update of [
    "min_selections=-1",
    "min_selections=2,max_selections=1",
    "max_selections=0",
    "max_selections=21",
    "selection_type='single',max_selections=2",
    "selection_type='unknown'",
  ])
    await assert.rejects(
      db.exec(`update public.product_modifier_groups set ${update}`),
      /check constraint/,
    );
  for (const value of [-1, 1000001])
    await assert.rejects(
      db.query("update public.modifier_options set price_adjustment_minor=$1", [
        value,
      ]),
      /check constraint/,
    );
});
