import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const r = "11111111-1111-4111-8111-111111111111",
  table = "22222222-2222-4222-8222-222222222221",
  product = "44444444-4444-4444-8444-444444444441";
const staff = "90000000-0000-4000-8000-000000000001",
  guest = "90000000-0000-4000-8000-000000000002",
  other = "90000000-0000-4000-8000-000000000003",
  order = "90000000-0000-4000-8000-000000000004",
  foreign = "90000000-0000-4000-8000-000000000005";
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
  await db.query("insert into auth.users(id) values($1),($2),($3)", [
    staff,
    guest,
    other,
  ]);
  await db.query(
    "insert into restaurant_members(restaurant_id,user_id,role) values($1,$2,'staff')",
    [r, staff],
  );
  await db.query(
    "insert into restaurants(id,slug,name) values($1,'kitchen-other','Other Kitchen')",
    [foreign],
  );
  await db.query(
    "insert into orders(id,restaurant_id,table_id,customer_id,currency,subtotal_minor,total_minor,restaurant_name,table_label) values($1,$2,$3,$4,'EUR',1400,1400,'Casa Mesa','Table 04')",
    [order, r, table, guest],
  );
  const visit = (
    await db.query(
      "insert into table_sessions(restaurant_id,table_id,table_label,currency) values($1,$2,'Table 04','EUR') returning id",
      [r, table],
    )
  ).rows[0].id;
  await db.query("update orders set session_id=$1 where id=$2", [visit, order]);
  await db.query(
    "insert into private.session_participants(restaurant_id,session_id,guest_id) values($1,$2,$3)",
    [r, visit, guest],
  );
  await db.query(
    "insert into order_items(restaurant_id,order_id,product_id,product_name,base_price_minor,unit_price_minor,quantity) values($1,$2,$3,'Eggs',1400,1400,1)",
    [r, order, product],
  );
});
after(() => db.close());
for (const role of ["owner", "manager", "staff"])
  test(`${role} membership may operate its restaurant`, () =>
    tx(async () => {
      await db.query("update restaurant_members set role=$1 where user_id=$2", [
        role,
        staff,
      ]);
      await identify();
      assert.equal((await change("pending", "accepted")).status, "accepted");
    }));
test("status version timestamps advance after transaction start and row-lock validation", () =>
  tx(async () => {
    await identify();
    // Embedded PostgreSQL's clock has millisecond resolution; distinguish
    // clock time from transaction-start now() without timing-dependent flakes.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await change("pending", "accepted");
    assert.equal(
      (
        await db.query(
          "select updated_at>transaction_timestamp() as advanced from orders where id=$1",
          [order],
        )
      ).rows[0].advanced,
      true,
    );
  }));
async function identify(id = staff, anonymous = false, role = "authenticated") {
  await db.exec(`set local role ${role}`);
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
    [id ?? "", JSON.stringify({ sub: id, is_anonymous: anonymous })],
  );
}
async function tx(run) {
  await db.exec("begin");
  try {
    await run();
  } finally {
    await db.exec("rollback");
  }
}
async function fails(run, message) {
  await db.exec("savepoint denied");
  try {
    await assert.rejects(run, new RegExp(message));
  } finally {
    await db.exec("rollback to savepoint denied");
  }
}
async function change(
  expected,
  next,
  reason = null,
  restaurant = r,
  id = order,
) {
  return (
    await db.query(
      "select transition_order($1,$2,$3::order_status,$4::order_status,$5) as result",
      [restaurant, id, expected, next, reason],
    )
  ).rows[0].result;
}
test("members receive an authoritative initial queue with item snapshots and timezone metrics", () =>
  tx(async () => {
    await identify();
    const data = (
      await db.query("select get_kitchen_snapshot($1) as data", [r])
    ).rows[0].data;
    assert.equal(data.orders.length, 1);
    assert.equal(data.orders[0].items[0].name, "Eggs");
    assert.equal(data.orders[0].totalMinor, 1400);
    assert.equal(data.metrics.pending, 1);
    assert.equal(data.metrics.receivedToday, 1);
    assert.equal(data.timezone, "Europe/Lisbon");
  }));
test("full operational lifecycle is atomic, audited and preserves immutable order contents", () =>
  tx(async () => {
    const before = (
      await db.query(
        "select total_minor,customer_id,restaurant_id,table_id from orders where id=$1",
        [order],
      )
    ).rows[0];
    await identify();
    let previous = "pending";
    for (const next of ["accepted", "preparing", "ready", "served"]) {
      assert.equal((await change(previous, next)).status, next);
      previous = next;
    }
    await db.exec("reset role");
    const after = (
      await db.query(
        "select total_minor,customer_id,restaurant_id,table_id from orders where id=$1",
        [order],
      )
    ).rows[0];
    assert.deepEqual(after, before);
    const row = (
      await db.query(
        "select accepted_at,preparing_at,ready_at,served_at from orders where id=$1",
        [order],
      )
    ).rows[0];
    assert.ok(Object.values(row).every(Boolean));
    const events = (
      await db.query(
        "select actor_id,previous_status,next_status from private.order_status_events where order_id=$1 order by occurred_at",
        [order],
      )
    ).rows;
    assert.equal(events.length, 4);
    assert.ok(events.every((e) => e.actor_id === staff));
    await identify();
    const snapshot = (
      await db.query("select get_kitchen_snapshot($1) as data", [r])
    ).rows[0].data;
    assert.equal(snapshot.metrics.pending, 0);
    assert.equal(snapshot.metrics.completedToday, 1);
    assert.equal(snapshot.orders[0].status, "served");
  }));
test("pending decline requires a customer-visible reason and records cancellation", () =>
  tx(async () => {
    await identify();
    await fails(() => change("pending", "cancelled"), "INVALID_REASON");
    assert.equal(
      (await change("pending", "cancelled", "Kitchen is closing")).cancelReason,
      "Kitchen is closing",
    );
    await db.exec("reset role");
    assert.ok(
      (await db.query("select cancelled_at from orders where id=$1", [order]))
        .rows[0].cancelled_at,
    );
    await identify(guest, true);
    const progress = (
      await db.query("select get_guest_order_progress('mesa',$1) as data", [
        order,
      ])
    ).rows[0].data;
    assert.equal(progress.status, "cancelled");
    assert.equal(progress.cancelReason, "Kitchen is closing");
  }));
const statuses = [
  "pending",
  "accepted",
  "preparing",
  "ready",
  "served",
  "cancelled",
];
for (const from of statuses)
  for (const to of statuses) {
    if (
      [
        "pending:accepted",
        "pending:ready",
        "pending:cancelled",
        "accepted:preparing",
        "accepted:ready",
        "preparing:ready",
        "ready:served",
      ].includes(`${from}:${to}`)
    )
      continue;
    test(`database rejects ${from} → ${to}`, () =>
      tx(async () => {
        await db.query("update orders set status=$1 where id=$2", [
          from,
          order,
        ]);
        await identify();
        await fails(() => change(from, to, "Declined"), "INVALID_TRANSITION");
      }));
  }
test("expected-current status rejects competing employees and duplicate actions", () =>
  tx(async () => {
    await identify();
    await change("pending", "accepted");
    await fails(
      () => change("pending", "cancelled", "Unavailable"),
      "STATUS_CONFLICT",
    );
    await fails(() => change("pending", "accepted"), "STATUS_CONFLICT");
    assert.equal(
      (await db.query("select status from orders where id=$1", [order])).rows[0]
        .status,
      "accepted",
    );
  }));
test("guests, visitors, unassigned identities and cross-restaurant requests cannot manage orders", () =>
  tx(async () => {
    await identify(guest, true);
    await fails(() => change("pending", "accepted"), "STAFF_REQUIRED");
    await fails(
      () => db.query("select get_kitchen_snapshot($1)", [r]),
      "STAFF_REQUIRED",
    );
    await identify(other, false);
    await fails(() => change("pending", "accepted"), "STAFF_FORBIDDEN");
    await identify();
    await fails(
      () => change("pending", "accepted", null, foreign),
      "STAFF_FORBIDDEN",
    );
    await fails(
      () => db.query("select get_kitchen_snapshot($1)", [foreign]),
      "STAFF_FORBIDDEN",
    );
    await identify(null, false, "anon");
    await fails(() => change("pending", "accepted"), "permission denied");
  }));
test("membership revocation takes effect on the next snapshot and transition", () =>
  tx(async () => {
    await db.query("delete from restaurant_members where user_id=$1", [staff]);
    await identify();
    await fails(
      () => db.query("select get_kitchen_snapshot($1)", [r]),
      "STAFF_FORBIDDEN",
    );
    await fails(() => change("pending", "accepted"), "STAFF_FORBIDDEN");
  }));
test("staff cannot directly edit statuses, totals, ownership, item snapshots or audit rows", () =>
  tx(async () => {
    await identify();
    for (const sql of [
      "update orders set status='served' where id=$1",
      "update orders set total_minor=0 where id=$1",
      "update orders set customer_id=null where id=$1",
      "update order_items set product_name='Forged' where order_id=$1",
      "select * from private.order_status_events",
    ])
      await fails(
        () => db.query(sql, sql.includes("$1") ? [order] : []),
        "permission denied",
      );
  }));
test("guest progress never grants access through a shared table or staff session", () =>
  tx(async () => {
    await identify(other, true);
    assert.equal(
      (
        await db.query("select get_guest_order_progress('mesa',$1) as data", [
          order,
        ])
      ).rows[0].data,
      null,
    );
    await identify(guest, true);
    assert.equal(
      (
        await db.query(
          "select get_guest_order_progress('kitchen-other',$1) as data",
          [order],
        )
      ).rows[0].data,
      null,
    );
    await identify();
    await fails(
      () => db.query("select get_guest_order_progress('mesa',$1)", [order]),
      "SESSION_REQUIRED",
    );
  }));
test("one prepared action confirms a new ticket atomically without inventing cooking time", () =>
  tx(async () => {
    await identify(guest, true);
    assert.equal((await db.query("select get_guest_table_bill('mesa') as bill")).rows[0].bill.access, "waiting");
    await identify();
    assert.equal((await change("pending", "ready")).status, "ready");
    await db.exec("reset role");
    const row = (await db.query("select status,accepted_at,preparing_at,ready_at,total_minor,customer_id,restaurant_id,table_id from orders where id=$1", [order])).rows[0];
    assert.equal(row.status, "ready");
    assert.ok(row.accepted_at && row.ready_at);
    assert.equal(row.preparing_at, null);
    assert.equal(row.total_minor, 1400);
    assert.equal(row.customer_id, guest);
    assert.equal(row.restaurant_id, r);
    assert.equal(row.table_id, table);
    const audit = (await db.query("select previous_status,next_status,actor_id from private.order_status_events where order_id=$1", [order])).rows;
    assert.deepEqual(audit, [{ previous_status: "pending", next_status: "ready", actor_id: staff }]);
    await identify(guest, true);
    const bill = (await db.query("select get_guest_table_bill('mesa') as bill")).rows[0].bill;
    assert.equal(bill.access, "active");
    assert.equal(bill.totals.confirmedMinor, 1400);
  }));
test("legacy accepted tickets go straight to prepared without rewriting acceptance or cooking timestamps", () =>
  tx(async () => {
    await identify();
    await change("pending", "accepted");
    const before = (await db.query("select accepted_at from orders where id=$1", [order])).rows[0].accepted_at;
    await change("accepted", "ready");
    const row = (await db.query("select accepted_at,preparing_at,ready_at from orders where id=$1", [order])).rows[0];
    assert.deepEqual(row.accepted_at, before);
    assert.equal(row.preparing_at, null);
    assert.ok(row.ready_at);
  }));
test("stale simultaneous prepared clicks create one transition and never mark food served", () =>
  tx(async () => {
    await identify();
    await change("pending", "ready");
    await fails(() => change("pending", "ready"), "STATUS_CONFLICT");
    assert.equal((await db.query("select status from orders where id=$1", [order])).rows[0].status, "ready");
    await db.exec("reset role");
    assert.equal((await db.query("select count(*)::int n from private.order_status_events where order_id=$1", [order])).rows[0].n, 1);
  }));
test("combined preparation never bypasses guest or cross-restaurant authorization", () =>
  tx(async () => {
    await identify(guest, true);
    await fails(() => change("pending", "ready"), "STAFF_REQUIRED");
    await identify(other, false);
    await fails(() => change("pending", "ready"), "STAFF_FORBIDDEN");
    await identify();
    await fails(() => change("pending", "ready", null, foreign), "STAFF_FORBIDDEN");
  }));
test("failed preparation audit rolls back the status, staff confirmation and shared-bill authorization", () =>
  tx(async () => {
    await db.exec("create function private.fail_prepared_audit() returns trigger language plpgsql as $$ begin raise exception 'PREPARED_AUDIT_FAILURE'; end $$;create trigger fail_prepared_audit before insert on private.order_status_events for each row execute function private.fail_prepared_audit()");
    await identify();
    await fails(() => change("pending", "ready"), "PREPARED_AUDIT_FAILURE");
    const row = (await db.query("select status,accepted_at,preparing_at,ready_at from orders where id=$1", [order])).rows[0];
    assert.deepEqual(row, { status: "pending", accepted_at: null, preparing_at: null, ready_at: null });
    await identify(guest, true);
    assert.equal((await db.query("select get_guest_table_bill('mesa') as bill")).rows[0].bill.access, "waiting");
  }));
test("audit insertion failure rolls back the status and timestamps", () =>
  tx(async () => {
    await db.exec(
      "create function private.fail_audit() returns trigger language plpgsql as $$ begin raise exception 'AUDIT_FAILURE'; end $$;create trigger fail_audit before insert on private.order_status_events for each row execute function private.fail_audit()",
    );
    await identify();
    await fails(() => change("pending", "accepted"), "AUDIT_FAILURE");
    assert.equal(
      (
        await db.query("select status,accepted_at from orders where id=$1", [
          order,
        ])
      ).rows[0].status,
      "pending",
    );
    assert.equal(
      (await db.query("select accepted_at from orders where id=$1", [order]))
        .rows[0].accepted_at,
      null,
    );
  }));
test("operational functions expose only narrow authenticated execution with safe search paths", async () => {
  const rows = (
    await db.query(
      "select proname,prosecdef,proconfig,has_function_privilege('anon',p.oid,'execute') as anon,has_function_privilege('authenticated',p.oid,'execute') as staff from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in('transition_order','get_kitchen_snapshot','get_guest_order_progress')",
    )
  ).rows;
  assert.equal(rows.length, 3);
  assert.ok(
    rows.every(
      (p) =>
        p.prosecdef &&
        !p.anon &&
        p.staff &&
        p.proconfig.some((c) => c.startsWith("search_path=")),
    ),
  );
});
