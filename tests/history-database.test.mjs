import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const restaurant = "11111111-1111-4111-8111-111111111111",
  table = "22222222-2222-4222-8222-222222222221",
  product = "44444444-4444-4444-8444-444444444441";
const guest = "a0000000-0000-4000-8000-000000000001",
  other = "a0000000-0000-4000-8000-000000000002",
  foreign = "a0000000-0000-4000-8000-000000000003",
  foreignTable = "a0000000-0000-4000-8000-000000000004";
const statuses = [
  "pending",
  "accepted",
  "preparing",
  "ready",
  "served",
  "cancelled",
];
let visit;
let ids = [],
  otherOrder;
before(async () => {
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema public,auth to anon,authenticated;create publication supabase_realtime;`);
  for (const name of (await readdir("supabase/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
  await db.exec(await readFile("supabase/seed.sql", "utf8"));
  await db.query("insert into auth.users(id) values($1),($2)", [guest, other]);
  await db.query(
    "insert into restaurants(id,slug,name,is_published) values($1,'other-history','Other',true)",
    [foreign],
  );
  await db.query(
    "insert into dining_tables(id,restaurant_id,label) values($1,$2,'Table 99')",
    [foreignTable, foreign],
  );
  visit = (
    await db.query(
      "insert into table_sessions(restaurant_id,table_id,table_label,currency) values($1,$2,'Table 04','EUR') returning id",
      [restaurant, table],
    )
  ).rows[0].id;
  await db.query(
    "insert into private.session_participants(restaurant_id,session_id,guest_id) values($1,$2,$3),($1,$2,$4)",
    [restaurant, visit, guest, other],
  );
  for (const status of statuses) ids.push(await insertOrder(guest, status));
  otherOrder = await insertOrder(other, "pending");
  await db.query(
    "insert into orders(restaurant_id,table_id,customer_id,currency,subtotal_minor,total_minor,restaurant_name,table_label) values($1,$2,$3,'EUR',500,500,'Other','Table 99')",
    [foreign, foreignTable, guest],
  );
});
after(() => db.close());
async function insertOrder(owner, status = "pending") {
  const id = (
    await db.query(
      "insert into orders(restaurant_id,table_id,customer_id,currency,subtotal_minor,total_minor,restaurant_name,table_label,status,cancellation_reason) values($1,$2,$3,'EUR',3300,3300,'Casa Mesa','Table 04',$4,$5) returning id",
      [
        restaurant,
        table,
        owner,
        status,
        status === "cancelled" ? "Kitchen closed" : null,
      ],
    )
  ).rows[0].id;
  await db.query("update orders set session_id=$1 where id=$2", [visit, id]);
  const options = [
    {
      id: "66666666-6666-4666-8666-666666666661",
      groupId: "55555555-5555-4555-8555-555555555551",
      groupName: "Extras",
      name: "Avocado",
      priceAdjustmentMinor: 250,
    },
  ];
  await db.query(
    "insert into order_items(restaurant_id,order_id,product_id,product_name,base_price_minor,unit_price_minor,quantity,selected_options) values($1,$2,$3,'Historical eggs',1400,1650,2,$4)",
    [restaurant, id, product, JSON.stringify(options)],
  );
  return id;
}
async function tx(run) {
  await db.exec("begin");
  try {
    await run();
  } finally {
    await db.exec("rollback");
  }
}
async function identify(
  id = guest,
  anonymous = true,
  role = "authenticated",
  sub = id,
) {
  await db.exec(`set local role ${role}`);
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
    [id ?? "", JSON.stringify({ sub, is_anonymous: anonymous })],
  );
}
async function history(slug = "mesa", cursor = null) {
  return (
    await db.query("select get_guest_order_history($1,$2) as data", [
      slug,
      cursor,
    ])
  ).rows[0].data;
}
test("all current-visit own orders are grouped at the restaurant with exact stored amounts, quantities and modifiers", () =>
  tx(async () => {
    await identify();
    const data = await history();
    assert.equal(data.orders.length, 6);
    assert.deepEqual(data.totals, {
      orderValueMinor: 16500,
      confirmedMinor: 13200,
      pendingMinor: 3300,
      cancelledMinor: 3300,
      confirmedCount: 4,
      pendingCount: 1,
      cancelledCount: 1,
      orderCount: 6,
    });
    assert.equal(data.orders[0].items[0].productName, "Historical eggs");
    assert.equal(data.orders[0].items[0].quantity, 2);
    assert.equal(data.orders[0].items[0].options[0].priceAdjustmentMinor, 250);
    assert.equal(
      data.orders.find((o) => o.status === "cancelled").cancelReason,
      "Kitchen closed",
    );
    assert.ok(
      data.orders.every(
        (o) => o.restaurant.id === restaurant && o.table.label === "Table 04",
      ),
    );
  }));
test("changing menu prices and modifier names cannot change the stored running bill", () =>
  tx(async () => {
    await db.query(
      "update products set price_minor=9999,name='Changed menu name' where id=$1",
      [product],
    );
    await identify();
    const data = await history();
    assert.equal(data.totals.confirmedMinor, 13200);
    assert.equal(data.orders[0].items[0].productName, "Historical eggs");
  }));
test("another guest at the same table cannot read or cursor into the first guest history", () =>
  tx(async () => {
    await identify(other);
    const data = await history();
    assert.equal(data.orders.length, 1);
    assert.equal(data.orders[0].id, otherOrder);
    assert.equal(data.totals.confirmedMinor, 0);
    await assert.rejects(() => history("mesa", ids[0]), /INVALID_REQUEST/);
  }));
test("another restaurant does not contribute to this ledger, even for the same guest", () =>
  tx(async () => {
    await identify();
    assert.equal((await history()).totals.orderCount, 6);
    const ownForeign = await history("other-history");
    assert.equal(ownForeign.totals.pendingMinor, 0);
    assert.equal(ownForeign.orders.length, 0);
  }));
test("minimal notification signals remain guest-owned and tenant-isolated through RLS", () =>
  tx(async () => {
    await identify();
    const signals = await db.query("select id,status,created_at,updated_at from orders where restaurant_id=$1 and session_id=$2", [restaurant, visit]);
    assert.equal(signals.rows.length, 6);
    assert.ok(signals.rows.every((row) => ids.includes(row.id)));
    assert.ok(!signals.rows.some((row) => row.id === otherOrder));
    assert.equal((await db.query("select id,status from orders where restaurant_id=$1", [foreign])).rows.length, 0);
  }));
test("closing the visit revokes notification signals without deleting historical records", () =>
  tx(async () => {
    await db.query("update table_sessions set status='closed',closed_at=clock_timestamp() where id=$1", [visit]);
    await identify();
    assert.equal((await db.query("select id,status,created_at,updated_at from orders where restaurant_id=$1 and session_id=$2", [restaurant, visit])).rows.length, 0);
    assert.equal((await db.query("select get_guest_table_bill('mesa',null) as data")).rows[0].data, null);
    await db.exec("reset role");
    assert.equal((await db.query("select count(*)::int as count from orders where session_id=$1", [visit])).rows[0].count, 7);
  }));
test("unknown restaurant, malformed slug, missing identity, permanent staff and forged JWT subject fail safely", async () => {
  await tx(async () => {
    await identify();
    assert.equal(await history("unknown"), null);
    await assert.rejects(() => history("../mesa"), /INVALID_REQUEST/);
  });
  for (const [id, anonymous, role, sub, message] of [
    [null, false, "anon", null, "permission denied"],
    [null, true, "authenticated", null, "SESSION_REQUIRED"],
    [guest, false, "authenticated", guest, "SESSION_REQUIRED"],
    [guest, true, "authenticated", other, "SESSION_REQUIRED"],
  ])
    await tx(async () => {
      await identify(id, anonymous, role, sub);
      await assert.rejects(() => history(), new RegExp(message));
    });
});
test("own active-visit orders remain private and available when the menu is unpublished", () =>
  tx(async () => {
    await db.query("update restaurants set is_published=false where id=$1", [
      restaurant,
    ]);
    await identify();
    assert.equal((await history()).orders.length, 6);
    await db.exec("reset role");
    await db.query("delete from order_items where order_id=$1", [otherOrder]);
    await db.query("delete from orders where id=$1", [otherOrder]);
    await identify(other);
    assert.equal(await history(), null);
  }));
test("cursor pagination retains complete aggregates, avoids tied timestamp duplicates and exposes every older order", () =>
  tx(async () => {
    for (let i = 0; i < 39; i++) await insertOrder(guest);
    await db.query(
      "update orders set created_at=$1 where customer_id=$2 and restaurant_id=$3",
      ["2026-10-14T12:00:00Z", guest, restaurant],
    );
    await identify();
    const seen = [];
    let cursor = null,
      page;
    do {
      page = await history("mesa", cursor);
      assert.equal(page.totals.orderCount, 45);
      assert.equal(page.totals.pendingMinor, 40 * 3300);
      seen.push(...page.orders.map((o) => o.id));
      cursor = page.nextCursor;
    } while (cursor);
    assert.equal(seen.length, 45);
    assert.equal(new Set(seen).size, 45);
    assert.equal(page.orders.length, 5);
  }));
test("status transitions change the authoritative pending and accepted aggregates", () =>
  tx(async () => {
    await db.query(
      "insert into restaurant_members(restaurant_id,user_id,role) values($1,$2,'staff')",
      [restaurant, other],
    );
    await identify(other, false);
    await db.query("select transition_order($1,$2,'pending','accepted',null)", [
      restaurant,
      ids[0],
    ]);
    await identify();
    const data = await history();
    assert.equal(data.totals.pendingMinor, 0);
    assert.equal(data.totals.confirmedMinor, 16500);
  }));
test("history execution is narrow, read-only and preserves row security", async () => {
  const p = (
    await db.query(
      "select prosecdef,proconfig,has_function_privilege('anon',p.oid,'execute') as anon,has_function_privilege('authenticated',p.oid,'execute') as guest from pg_proc p where oid='get_guest_order_history(text,uuid)'::regprocedure",
    )
  ).rows[0];
  assert.ok(
    p.prosecdef &&
      p.guest &&
      !p.anon &&
      p.proconfig.some((c) => c.startsWith("search_path=")),
  );
  assert.equal(
    (
      await db.query(
        "select relrowsecurity from pg_class where oid='orders'::regclass",
      )
    ).rows[0].relrowsecurity,
    true,
  );
  assert.ok(
    (
      await db.query(
        "select indexname from pg_indexes where indexname='orders_guest_history_idx'",
      )
    ).rows.length,
  );
});
