import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { databaseItems, parseReviewRequest } from "../src/features/orders/payload.ts";

// Real migration SQL, isolated embedded PostgreSQL. This deliberately does NOT
// claim concurrent transactions: the hosted campaign uses separate connections.
const db = new PGlite();
const r = "11111111-1111-4111-8111-111111111111";
const table = "22222222-2222-4222-8222-222222222221";
const product = "44444444-4444-4444-8444-444444444441";
const staff = randomUUID();
let token, bread;
before(async () => {
  await db.exec(`create role anon;create role authenticated;create schema auth;
    create table auth.users(id uuid primary key,is_anonymous boolean default false);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema public,auth to anon,authenticated;create publication supabase_realtime;`);
  for (const name of (await readdir("supabase/migrations")).filter(n => n.endsWith(".sql")).sort())
    await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
  await db.exec(await readFile("supabase/seed.sql", "utf8"));
  await db.query("insert into auth.users(id) values($1)", [staff]);
  await db.query("insert into restaurant_members(restaurant_id,user_id,role) values($1,$2,'owner')", [r, staff]);
  token = (await db.query("select qr_token from dining_tables where id=$1", [table])).rows[0].qr_token;
  bread = (await db.query("select id from modifier_options where name='Toasted brioche'")).rows[0].id;
});
after(() => db.close());
async function identify(id, anon = true) {
  await db.exec("reset role;set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)", [id, JSON.stringify({ sub: id, is_anonymous: anon })]);
}
async function rpc(name, args) {
  return (await db.query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as result`, args)).rows[0].result;
}
async function deny(run, code) {
  await db.exec("savepoint expected_failure");
  try { await assert.rejects(run, new RegExp(code)); }
  finally { await db.exec("rollback to savepoint expected_failure;release savepoint expected_failure"); }
}
async function quote(items, visit) { return rpc("review_visit_order", ["mesa", token, JSON.stringify(items), visit]); }
async function submit(q, items, key) { return rpc("create_guest_order", ["mesa", token, JSON.stringify(items), key, q.reviewId]); }
async function change(order, from, to) {
  await identify(staff, false);
  return rpc("transition_order", [r, order.id, from, to, to === "cancelled" ? "Test ingredient unavailable" : null]);
}
const manage = (operation, session) => rpc("manage_table_session", [r, table, operation, session]);

test("600 Unicode/whitespace requests canonicalize identically in JavaScript and PostgreSQL", async () => {
  const text = ["Sem cebola", "Molho à parte", "辛くしないで", "بدون بصل", "😀", "e\u0301", "<script>alert(1)</script>", "💚🥑", "A\tB\r\nC"];
  const space = [" ", "\t", "\n", "\r", "\u00a0", "\u1680", "\u2003", "\u2028", "\u2029", "\u202f", "\u205f", "\u3000", "\ufeff"];
  const request = { restaurantSlug: "mesa", tableToken: token, visitKey: randomUUID() };
  for (let n = 0; n < 600; n++) {
    const items = [{ productId: product.toUpperCase(), quantity: n % 99 + 1, optionIds: [bread.toUpperCase()],
      notes: space[n % space.length] + text[n % text.length] + space[(n * 7) % space.length] }];
    const js = databaseItems(parseReviewRequest({ ...request, items }).items);
    const sql = (await db.query("select private.normalize_order_items($1::jsonb) value", [JSON.stringify(items)])).rows[0].value;
    assert.deepEqual(sql, js, `normalization case ${n}`);
  }
});

test("500 malformed order intents fail without writing orders, items or sessions", async () => {
  await db.exec("begin");
  try {
    const guest = randomUUID();
    await db.query("insert into auth.users(id,is_anonymous) values($1,true)", [guest]);
    await identify(guest);
    const [{ visit_key: visit }] = (await db.query("select * from resolve_table_visit($1,$2)", ["mesa", token])).rows;
    const valid = { productId: product, optionIds: [bread], quantity: 1 };
    const corruptions = [
      i => { i[0].quantity = 0; }, i => { i[0].quantity = 100; }, i => { i[0].quantity = 1.5; }, i => { i[0].quantity = "1"; },
      i => { i[0].optionIds = [bread, bread]; }, i => { i[0].optionIds = [randomUUID()]; }, i => { i[0].optionIds = []; },
      i => { i[0].productId = randomUUID(); }, i => { i[0].notes = "x".repeat(301); }, i => { i[0].notes = null; },
      i => { i[0].notes = "\u0001"; }, i => { i[0].notes = "😀".repeat(151); }, i => { i[0].totalMinor = 1; },
      i => { i[0].customerId = staff; }, i => { i[0].status = "served"; }, i => { i.push({ ...i[0] }); },
    ];
    for (let n = 0; n < 500; n++) {
      const items = [{ ...valid, optionIds: [...valid.optionIds] }]; corruptions[n % corruptions.length](items);
      await deny(() => quote(items, visit), "INVALID_REQUEST|QUANTITY_INVALID|OPTIONS_INVALID|PRODUCT_UNAVAILABLE");
    }
    await db.exec("reset role");
    for (const name of ["orders", "order_items", "table_sessions"])
      assert.equal((await db.query(`select count(*)::int n from public.${name} where restaurant_id=$1`, [r])).rows[0].n, 0);
  } finally { await db.exec("rollback"); }
});

for (const seed of [7, 23, 51, 99, 314, 1009, 2026, 65537]) {
  test(`ten successive restaurant visits with three diners, cancellations and fresh bills (seed ${seed})`, async () => {
    await db.exec("begin");
    try {
      let previousVisit;
      for (let visitNo = 0; visitNo < 10; visitNo++) {
        await db.exec("reset role");
        const guests = [randomUUID(), randomUUID(), randomUUID()];
        for (const id of guests) await db.query("insert into auth.users(id,is_anonymous) values($1,true)", [id]);
        const price = 900 + ((seed * 17 + visitNo * 13) % 1000);
        await db.query("update products set price_minor=$1 where id=$2", [price, product]);
        await identify(guests[0]);
        const [{ visit_key: visit }] = (await db.query("select * from resolve_table_visit($1,$2)", ["mesa", token])).rows;
        assert.notEqual(visit, previousVisit);
        previousVisit = visit;
        assert.equal(await rpc("get_guest_table_bill", ["mesa", token]), null);
        const orders = [];
        for (let diner = 0; diner < 3; diner++) {
          await identify(guests[diner]);
          const quantity = 1 + ((seed + visitNo + diner) % 4);
          const items = [{ productId: product, optionIds: [bread], quantity, notes: `Visit ${visitNo}, private diner ${diner}` }];
          const q = await quote(items, visit), key = randomUUID();
          assert.equal(q.totalMinor, price * quantity);
          const order = await submit(q, items, key);
          assert.equal(order.totalMinor, price * quantity);
          assert.equal((await submit(q, items, key)).id, order.id);
          const waiting = await rpc("get_guest_table_bill", ["mesa", token]);
          assert.equal(waiting.access, "waiting"); assert.equal(waiting.totals, undefined);
          orders.push({ order, key, q, items });
        }
        const session = (await rpc("get_guest_table_bill", ["mesa", token])).id;
        await identify(staff, false);
        const workspace = await rpc("get_table_workspace", [r]);
        const current = workspace.tables.find(t => t.id === table).session;
        assert.equal(current.id, session);
        assert.equal(current.totals.pendingMinor, orders.reduce((n, o) => n + o.order.totalMinor, 0));
        await deny(() => manage("close", session), "ACTIVE_ORDERS");
        // Every guest has their own receipt even though all three share a QR.
        for (let diner = 0; diner < 3; diner++) {
          await identify(guests[diner]);
          for (let other = 0; other < 3; other++) {
            const receipt = await rpc("get_guest_order", ["mesa", orders[other].order.id]);
            assert.equal(receipt?.id ?? null, diner === other ? orders[other].order.id : null);
          }
          const history = await rpc("get_guest_visit_order_history", ["mesa", token]);
          assert.equal(history.orders.length, 1);
        }
        await change(orders[0].order, "pending", "ready");
        await identify(guests[0]);
        const mixed = await rpc("get_guest_table_bill", ["mesa", token]);
        assert.equal(mixed.access, "active");
        assert.equal(mixed.totals.confirmedMinor, orders[0].order.totalMinor);
        assert.equal(mixed.totals.pendingMinor, orders[1].order.totalMinor + orders[2].order.totalMinor);
        await change(orders[1].order, "pending", "ready");
        await change(orders[2].order, "pending", "cancelled");
        await identify(guests[1]);
        const bill = await rpc("get_guest_table_bill", ["mesa", token]);
        const confirmed = orders[0].order.totalMinor + orders[1].order.totalMinor;
        assert.equal(bill.totals.orderValueMinor, confirmed);
        assert.equal(bill.totals.confirmedMinor, confirmed);
        assert.equal(bill.totals.pendingMinor, 0);
        assert.equal(bill.totals.cancelledMinor, orders[2].order.totalMinor);
        const json = JSON.stringify(bill);
        for (const id of guests) assert.ok(!json.includes(id));
        for (const o of orders) { assert.ok(!json.includes(o.order.id)); assert.ok(!json.includes(o.items[0].notes)); }
        // Editing today's recipe never rewrites yesterday's order snapshot.
        await db.exec("reset role");
        await db.query("update products set price_minor=$1,name=$2 where id=$3", [price + 777, `New recipe ${visitNo}`, product]);
        await identify(guests[0]);
        assert.equal((await rpc("get_guest_order", ["mesa", orders[0].order.id])).totalMinor, orders[0].order.totalMinor);
        await rpc("request_session_bill", ["mesa", session]);
        const requestId = (await rpc("get_guest_table_bill", ["mesa", token])).request.id;
        await identify(guests[1]);
        await rpc("request_session_bill", ["mesa", session]);
        assert.equal((await rpc("get_guest_table_bill", ["mesa", token])).request.id, requestId);
        await change(orders[0].order, "ready", "served");
        await change(orders[1].order, "ready", "served");
        await identify(staff, false);
        await deny(() => manage("close", session), "REQUEST_UNACKNOWLEDGED");
        await manage("acknowledge", session);
        await manage("close", session);
        for (let diner = 0; diner < 3; diner++) {
          await identify(guests[diner]);
          assert.equal(await rpc("get_guest_order", ["mesa", orders[diner].order.id]), null);
          assert.equal(await rpc("get_guest_order", ["mesa", null, orders[diner].key]), null);
          assert.equal(await rpc("get_guest_order_progress", ["mesa", orders[diner].order.id]), null);
          assert.equal(await rpc("get_guest_table_bill", ["mesa", token]), null);
          assert.equal((await rpc("get_guest_visit_order_history", ["mesa", token])).orders.length, 0);
          for (const name of ["orders", "order_items", "table_sessions", "bill_requests"])
            assert.equal((await db.query(`select id from public.${name}`)).rows.length, 0);
          await deny(() => submit(orders[diner].q, orders[diner].items, orders[diner].key), "VISIT_ENDED");
        }
        await identify(staff, false);
        const retained = await rpc("get_staff_session_orders", [r, session]);
        assert.equal(retained.orders.length, 3);
        for (const o of orders) {
          const historical = retained.orders.find(v => v.id === o.order.id);
          assert.equal(historical.totalMinor, o.order.totalMinor);
          assert.equal(historical.items[0].notes, o.items[0].notes);
        }
      }
      await db.exec("reset role");
      assert.equal((await db.query("select count(*)::int n from table_sessions where restaurant_id=$1 and table_id=$2 and status='closed'", [r, table])).rows[0].n, 10);
      assert.equal((await db.query("select count(*)::int n from orders where restaurant_id=$1", [r])).rows[0].n, 30);
    } finally { await db.exec("rollback"); }
  });
}
