import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { decodeDailyReport } from "../src/features/reports/model.ts";

const db = new PGlite();
const r = "11111111-1111-4111-8111-111111111111",
  table = "22222222-2222-4222-8222-222222222221";
const product = "44444444-4444-4444-8444-444444444441",
  otherProduct = "44444444-4444-4444-8444-444444444442";
const owner = randomUUID(),
  manager = randomUUID(),
  staff = randomUUID(),
  guest = randomUUID(),
  outsider = randomUUID();
const foreign = randomUUID(),
  foreignTable = randomUUID();
before(async () => {
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    grant usage on schema public,auth to anon,authenticated;create publication supabase_realtime;`);
  for (const name of (await readdir("supabase/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
  await db.exec(await readFile("supabase/seed.sql", "utf8"));
  for (const id of [owner, manager, staff, guest, outsider])
    await db.query("insert into auth.users values($1)", [id]);
  for (const [id, role] of [
    [owner, "owner"],
    [manager, "manager"],
    [staff, "staff"],
    [guest, "owner"],
  ])
    await db.query(
      "insert into restaurant_members(restaurant_id,user_id,role) values($1,$2,$3)",
      [r, id, role],
    );
  await db.query(
    "insert into restaurants(id,slug,name,is_published,is_accepting_orders) values($1,'report-other','Other',true,true)",
    [foreign],
  );
  await db.query(
    "insert into dining_tables(id,restaurant_id,label) values($1,$2,'Other table')",
    [foreignTable, foreign],
  );
});
after(() => db.close());
async function tx(run, readonly = false) {
  await db.exec(readonly ? "begin read only" : "begin");
  try {
    await run();
  } finally {
    await db.exec("rollback");
  }
}
async function identify(
  id = owner,
  anonymous = false,
  role = "authenticated",
  claims = {},
) {
  await db.exec(`reset role;set local role ${role}`);
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
    [id ?? "", JSON.stringify({ sub: id, is_anonymous: anonymous, ...claims })],
  );
}
async function denied(run, code) {
  await db.exec("savepoint denial");
  try {
    await assert.rejects(run, new RegExp(code));
  } finally {
    await db.exec("rollback to savepoint denial;release savepoint denial");
  }
}
async function report(
  day = "2026-10-20",
  currency = null,
  cursor = null,
  restaurant = r,
) {
  return (
    await db.query(
      "select public.get_daily_restaurant_report($1,$2::date,$3,$4) value",
      [restaurant, day, currency, cursor],
    )
  ).rows[0].value;
}
async function order({
  at = "2026-10-20T12:00:00Z",
  status = "served",
  price = 1000,
  quantity = 1,
  dish = product,
  name = "Original dish",
  currency = "EUR",
  restaurant = r,
  id = randomUUID(),
  options = [],
} = {}) {
  await db.exec("reset role");
  await db.query(
    "insert into orders(id,restaurant_id,table_id,customer_id,currency,subtotal_minor,total_minor,status,created_at,table_label,restaurant_name) values($1,$2,$3,$4,$5,$6,$6,$7,$8,'Table 04','Snapshot restaurant')",
    [
      id,
      restaurant,
      restaurant === r ? table : foreignTable,
      guest,
      currency,
      price * quantity,
      status,
      at,
    ],
  );
  if (restaurant === r)
    await db.query(
      "insert into order_items(restaurant_id,order_id,product_id,product_name,base_price_minor,unit_price_minor,quantity,selected_options,notes) values($1,$2,$3,$4,$5,$6,$7,$8,'Private historical request')",
      [
        r,
        id,
        dish,
        name,
        price - options.reduce((s, o) => s + o.priceAdjustmentMinor, 0),
        price,
        quantity,
        JSON.stringify(options),
      ],
    );
  return id;
}

for (const id of [owner, manager])
  test(`${id === owner ? "owner" : "manager"} can read the whole daily history`, () =>
    tx(async () => {
      const idOrder = await order();
      await identify(id);
      const value = await report();
      assert.equal(value.orders[0].id, idOrder);
      assert.equal(value.totals.confirmedMinor, 1000);
      decodeDailyReport(value, r);
    }));

test("staff, guests with accidental ownership, outsiders, forged claims and API anon cannot read reports", () =>
  tx(async () => {
    for (const [id, anon, code] of [
      [staff, false, "MANAGER_REQUIRED"],
      [guest, true, "STAFF_REQUIRED"],
      [outsider, false, "STAFF_FORBIDDEN"],
      [null, false, "STAFF_REQUIRED"],
    ]) {
      await identify(id, anon);
      await denied(() => report(), code);
    }
    await identify(owner, false, "authenticated", { sub: outsider });
    await denied(() => report(), "STAFF_REQUIRED");
    await identify(null, false, "anon");
    await denied(() => report(), "permission denied");
  }));

test("cross-restaurant reporting and cursor reuse cannot reveal another tenant", () =>
  tx(async () => {
    await order();
    const foreignOrder = await order({ restaurant: foreign });
    await identify();
    await denied(
      () => report("2026-10-20", null, null, foreign),
      "STAFF_FORBIDDEN",
    );
    await denied(
      () => report("2026-10-20", null, foreignOrder),
      "REPORT_INVALID",
    );
    assert.equal((await report()).totals.orderCount, 1);
  }));

test("all six statuses separate confirmed, pending and cancelled amounts and count units rather than lines", () =>
  tx(async () => {
    for (const status of [
      "pending",
      "accepted",
      "preparing",
      "ready",
      "served",
      "cancelled",
    ])
      await order({ status, quantity: 3, price: 1250 });
    await identify();
    const value = await report();
    assert.deepEqual(value.totals, {
      orderCount: 6,
      confirmedCount: 4,
      pendingCount: 1,
      cancelledCount: 1,
      servedCount: 1,
      confirmedMinor: 15000,
      pendingMinor: 3750,
      cancelledMinor: 3750,
      dishCount: 12,
    });
    assert.equal(value.products[0].quantity, 12);
    assert.equal(value.products[0].orderCount, 4);
    assert.equal(value.products[0].totalMinor, 15000);
    decodeDailyReport(value, r);
  }));

test("local midnight includes the start, excludes the end and groups by placement date", () =>
  tx(async () => {
    await order({ at: "2026-10-19T22:59:59.999Z" });
    await order({ at: "2026-10-19T23:00:00Z" });
    await order({ at: "2026-10-20T22:59:59.999Z" });
    await order({ at: "2026-10-20T23:00:00Z" });
    await identify();
    assert.equal((await report()).totals.orderCount, 2);
  }));

for (const [day, start, end] of [
  ["2026-03-29", "2026-03-29T00:00:00Z", "2026-03-29T23:00:00Z"],
  ["2026-10-25", "2026-10-24T23:00:00Z", "2026-10-26T00:00:00Z"],
])
  test(`restaurant-local DST day ${day} uses independent midnight boundaries`, () =>
    tx(async () => {
      await order({ at: new Date(Date.parse(start) - 1).toISOString() });
      await order({ at: start });
      await order({ at: new Date(Date.parse(end) - 1).toISOString() });
      await order({ at: end });
      await identify();
      assert.equal((await report(day)).totals.orderCount, 2);
    }));

test("85 tied-timestamp receipts paginate once each while every page retains full-day totals/rankings", () =>
  tx(async () => {
    for (let i = 0; i < 85; i++) await order();
    await identify();
    const seen = new Set();
    let cursor = null;
    const sizes = [];
    do {
      const page = await report("2026-10-20", null, cursor);
      decodeDailyReport(page, r);
      assert.equal(page.totals.confirmedMinor, 85000);
      assert.equal(page.products[0].quantity, 85);
      for (const o of page.orders) {
        assert.ok(!seen.has(o.id));
        seen.add(o.id);
      }
      sizes.push(page.orders.length);
      cursor = page.nextCursor;
    } while (cursor);
    assert.equal(seen.size, 85);
    assert.deepEqual(sizes, [40, 40, 5]);
  }));

test("archiving/editing the menu cannot rewrite historical names, supplements, private notes or prices", () =>
  tx(async () => {
    const option = {
      id: randomUUID(),
      groupId: randomUUID(),
      groupName: "Extras",
      name: "Avocado",
      priceAdjustmentMinor: 150,
    };
    await order({
      name: "Old dish name",
      price: 1450,
      quantity: 2,
      options: [option],
    });
    await db.query(
      "update products set name='Changed menu',price_minor=9999,is_published=false,archived_at=now() where id=$1",
      [product],
    );
    await identify();
    const value = await report();
    assert.equal(value.products[0].name, "Old dish name");
    assert.equal(value.products[0].totalMinor, 2900);
    assert.equal(value.orders[0].items[0].options[0].name, "Avocado");
    assert.equal(value.orders[0].items[0].notes, "Private historical request");
    decodeDailyReport(value, r);
  }));

test("dish identity combines customization variants and renamed snapshots while retaining each receipt", () =>
  tx(async () => {
    await order({
      name: "Earlier name",
      at: "2026-10-20T09:00:00Z",
      quantity: 2,
    });
    await order({
      name: "Latest ordered name",
      at: "2026-10-20T10:00:00Z",
      quantity: 3,
      price: 1200,
    });
    await order({
      name: "Other dish",
      dish: otherProduct,
      quantity: 4,
      price: 500,
    });
    await identify();
    const value = await report();
    assert.equal(value.products.length, 2);
    assert.equal(value.products[0].productId, product);
    assert.equal(value.products[0].quantity, 5);
    assert.equal(value.products[0].name, "Latest ordered name");
    assert.equal(value.products[0].totalMinor, 5600);
    assert.ok(value.orders.some((o) => o.items[0].name === "Earlier name"));
  }));

test("different historical currencies are never added together and cursor currency is bound", () =>
  tx(async () => {
    const eur = await order({ currency: "EUR", price: 1200 });
    await order({ currency: "USD", price: 1800 });
    await identify();
    const euro = await report(),
      dollar = await report("2026-10-20", "USD");
    assert.deepEqual(euro.currencies, ["EUR", "USD"]);
    assert.equal(euro.totals.confirmedMinor, 1200);
    assert.equal(dollar.totals.confirmedMinor, 1800);
    assert.equal(dollar.orders[0].currency, "USD");
    await denied(() => report("2026-10-20", "USD", eur), "REPORT_INVALID");
  }));

test("empty days and days containing only cancelled/pending orders have no fabricated ranking", () =>
  tx(async () => {
    await order({ status: "pending" });
    await order({ status: "cancelled" });
    await identify();
    const value = await report();
    assert.equal(value.totals.confirmedMinor, 0);
    assert.deepEqual(value.products, []);
    assert.equal(value.orders.length, 2);
    const empty = await report("2026-10-19");
    assert.equal(empty.totals.orderCount, 0);
    assert.deepEqual(empty.orders, []);
    decodeDailyReport(empty, r);
  }));

test("daily money sums use bigint instead of overflowing the per-order integer column", () =>
  tx(async () => {
    for (let i = 0; i < 3; i++) await order({ price: 2147483647 });
    await identify();
    const value = await report();
    assert.equal(value.totals.confirmedMinor, 6442450941);
    assert.equal(value.products[0].totalMinor, 6442450941);
    decodeDailyReport(value, r);
  }));

test("a cursor from another date and invalid report options are rejected", () =>
  tx(async () => {
    const id = await order({ at: "2026-10-19T10:00:00Z" });
    await identify();
    await denied(() => report("2026-10-20", null, id), "REPORT_INVALID");
    await denied(() => report("1999-12-31"), "REPORT_INVALID");
    await denied(() => report("2026-10-20", "ABC"), "REPORT_INVALID");
  }));

test("report executes in hosted PostgREST-style read-only transactions and supports restaurant-local today", () =>
  tx(async () => {
    await identify();
    const value = await report(null);
    assert.equal(value.day, value.today);
    assert.equal(value.restaurantId, r);
  }, true));

test("report access is revoked on the next request when an owner is demoted", () =>
  tx(async () => {
    await identify();
    assert.equal((await report()).restaurantId, r);
    await db.exec("reset role");
    await db.query(
      "update restaurant_members set role='staff' where restaurant_id=$1 and user_id=$2",
      [r, owner],
    );
    await identify();
    await denied(() => report(), "MANAGER_REQUIRED");
  }));

test("function keeps a fixed safe search path, authenticated-only execution and a date-range index", async () => {
  const row = (
    await db.query(
      "select proconfig,provolatile,prosecdef from pg_proc where oid='public.get_daily_restaurant_report(uuid,date,text,uuid)'::regprocedure",
    )
  ).rows[0];
  assert.equal(row.prosecdef, true);
  assert.equal(row.provolatile, "s");
  assert.ok(row.proconfig.some((v) => v === 'search_path=""'));
  assert.equal(
    (
      await db.query(
        "select has_function_privilege('anon','public.get_daily_restaurant_report(uuid,date,text,uuid)','execute') value",
      )
    ).rows[0].value,
    false,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from pg_indexes where indexname='orders_restaurant_history_idx'",
      )
    ).rows[0].n,
    1,
  );
});
