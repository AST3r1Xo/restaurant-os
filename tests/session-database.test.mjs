import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const r = "11111111-1111-4111-8111-111111111111",
  t = "22222222-2222-4222-8222-222222222221",
  product = "44444444-4444-4444-8444-444444444441";
const a = "80000000-0000-4000-8000-000000000001",
  b = "80000000-0000-4000-8000-000000000002",
  staff = "80000000-0000-4000-8000-000000000003",
  outsider = "80000000-0000-4000-8000-000000000004",
  foreign = "80000000-0000-4000-8000-000000000005";
let token, bread;
before(async () => {
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
 grant usage on schema public,auth to anon,authenticated;create publication supabase_realtime;`);
  for (const n of (await readdir("supabase/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await db.exec(await readFile("supabase/migrations/" + n, "utf8"));
  await db.exec(await readFile("supabase/seed.sql", "utf8"));
  await db.query("insert into auth.users(id) values($1),($2),($3),($4)", [
    a,
    b,
    staff,
    outsider,
  ]);
  await db.query(
    "insert into restaurant_members(restaurant_id,user_id,role) values($1,$2,'staff')",
    [r, staff],
  );
  await db.query(
    "insert into restaurants(id,slug,name,is_published) values($1,'session-other','Other',true)",
    [foreign],
  );
  token = (
    await db.query("select qr_token from dining_tables where id=$1", [t])
  ).rows[0].qr_token;
  bread = (
    await db.query(
      "select id from modifier_options where name='Toasted brioche'",
    )
  ).rows[0].id;
});
after(() => db.close());
async function tx(run) {
  await db.exec("begin");
  try {
    await run();
  } finally {
    await db.exec("rollback");
  }
}
async function identify(id = a, anon = true) {
  await db.exec("set local role authenticated");
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
    [id ?? "", JSON.stringify({ sub: id, is_anonymous: anon })],
  );
}
async function admin() {
  await db.exec("reset role");
}
async function fails(run, expected) {
  await db.exec("savepoint fail");
  try {
    await assert.rejects(run, new RegExp(expected));
  } finally {
    await db.exec("rollback to savepoint fail");
  }
}
async function call(name, args = []) {
  if (name === "review_guest_order") {
    name = "review_visit_order";
    const key =
      (
        await db.query(
          "select visit_key from public.resolve_table_visit($1,$2)",
          args.slice(0, 2),
        )
      ).rows[0]?.visit_key ?? randomUUID();
    args = [...args, key];
  }
  return (
    await db.query(
      `select ${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as result`,
      args,
    )
  ).rows[0].result;
}
async function create(owner = a, qty = 1) {
  await identify(owner);
  const items = [{ productId: product, quantity: qty, optionIds: [bread] }],
    key = randomUUID();
  const review = await call("review_guest_order", [
    "mesa",
    token,
    JSON.stringify(items),
  ]);
  const order = await call("create_guest_order", [
    "mesa",
    token,
    JSON.stringify(items),
    key,
    review.reviewId,
  ]);
  return { order, key, review, items };
}
async function bill() {
  return call("get_guest_table_bill", ["mesa", token]);
}
async function workspace() {
  return call("get_table_workspace", [r]);
}
async function manage(op, s = null, table = t, restaurant = r) {
  await identify(staff, false);
  return call("manage_table_session", [restaurant, table, op, s]);
}
async function change(o, from, to, reason = null) {
  await identify(staff, false);
  return call("transition_order", [r, o.id, from, to, reason]);
}
async function complete(o) {
  for (const [f, n] of [
    ["pending", "accepted"],
    ["accepted", "preparing"],
    ["preparing", "ready"],
    ["ready", "served"],
  ])
    await change(o, f, n);
}
async function seeded() {
  const x = await create(a),
    y = await create(b, 2);
  await identify(a);
  return { x, y, session: (await bill()).id };
}

test("staff can start one empty session, repeated open returns it, and unique index rejects a competing insert", () =>
  tx(async () => {
    const session = await manage("open");
    assert.equal(await manage("open"), session);
    assert.equal(
      (await workspace()).tables.find((x) => x.id === t).session.totals
        .orderValueMinor,
      0,
    );
    await admin();
    await fails(
      () =>
        db.query(
          "insert into table_sessions(restaurant_id,table_id,table_label,currency) values($1,$2,'Table 04','EUR')",
          [r, t],
        ),
      "duplicate key",
    );
  }));
test("two guest orders share one active session and order linkage is immutable and tenant-bound", () =>
  tx(async () => {
    const { x, y, session } = await seeded();
    await admin();
    const rows = (
      await db.query("select id,session_id from orders where id in($1,$2)", [
        x.order.id,
        y.order.id,
      ])
    ).rows;
    assert.ok(rows.every((o) => o.session_id === session));
    assert.equal(
      (await db.query("select count(*)::int as n from table_sessions")).rows[0]
        .n,
      1,
    );
    await fails(
      () =>
        db.query("update orders set session_id=null where id=$1", [x.order.id]),
      "SESSION_IMMUTABLE",
    );
    await fails(
      () =>
        db.query("update orders set restaurant_id=$1 where id=$2", [
          foreign,
          x.order.id,
        ]),
      "SESSION_IMMUTABLE",
    );
  }));
test("QR possession, authenticated outsiders and pending guests do not authorize shared totals or request access", () =>
  tx(async () => {
    const { session } = await seeded();
    assert.equal((await bill()).access, "waiting");
    assert.equal((await bill()).totals, undefined);
    await fails(
      () => call("request_session_bill", ["mesa", session]),
      "PARTICIPATION_REQUIRED",
    );
    await identify(outsider);
    assert.equal(await bill(), null);
    assert.equal(
      (await db.query("select * from table_sessions")).rows.length,
      0,
    );
    await fails(
      () => call("request_session_bill", ["mesa", session]),
      "PARTICIPATION_REQUIRED",
    );
  }));
test("acceptance authorizes shared dishes and prices without exposing identities or private receipts", () =>
  tx(async () => {
    const { x, y } = await seeded();
    await change(x.order, "pending", "accepted");
    await identify(a);
    const shared = await bill();
    assert.equal(shared.access, "active");
    assert.equal(shared.totals.confirmedMinor, 1400);
    assert.equal(shared.totals.pendingMinor, 2800);
    assert.equal(shared.totals.orderValueMinor, 4200);
    assert.ok(!JSON.stringify(shared).includes(b));
    assert.equal(shared.orders, undefined);
    assert.equal(shared.items, undefined);
    assert.equal(shared.lines.length, 2);
    assert.equal(shared.lines.find((l) => l.status === "pending").quantity, 2);
    assert.equal(shared.lines[0].name, "Smoked salmon eggs");
    assert.equal(shared.lines[0].options[0].name, "Toasted brioche");
    assert.ok(!JSON.stringify(shared).includes(y.order.id));
    assert.ok(!JSON.stringify(shared).includes(y.order.reference));
    assert.equal(await call("get_guest_order", ["mesa", y.order.id]), null);
    assert.equal((await db.query("select id from orders")).rows.length, 1);
    await identify(b);
    assert.equal((await bill()).access, "waiting");
    await change(y.order, "pending", "cancelled", "Sold out");
    await identify(a);
    assert.equal((await bill()).totals.orderValueMinor, 1400);
    assert.equal((await bill()).totals.cancelledMinor, 2800);
  }));

test("shared bill groups identical dishes across guests, keeps customizations separate, and uses immutable prices", () =>
  tx(async () => {
    const x = await create(a),
      y = await create(b, 2);
    await change(x.order, "pending", "accepted");
    await change(y.order, "pending", "accepted");
    await identify(a);
    let shared = await bill();
    assert.equal(shared.lines.length, 1);
    assert.equal(shared.lines[0].quantity, 3);
    assert.equal(shared.lines[0].lineTotalMinor, 4200);
    const avocado = (
      await db.query("select id from modifier_options where name='Avocado'")
    ).rows[0].id;
    const items = [
      { productId: product, quantity: 1, optionIds: [bread, avocado] },
    ];
    const review = await call("review_guest_order", [
      "mesa",
      token,
      JSON.stringify(items),
    ]);
    await call("create_guest_order", [
      "mesa",
      token,
      JSON.stringify(items),
      randomUUID(),
      review.reviewId,
    ]);
    await admin();
    await db.query("update products set price_minor=9999 where id=$1", [
      product,
    ]);
    await identify(a);
    shared = await bill();
    assert.equal(shared.lines.length, 2);
    assert.equal(
      shared.lines.find((l) => l.options.length === 2).lineTotalMinor,
      1650,
    );
    assert.equal(shared.totals.orderValueMinor, 5850);
    assert.deepEqual(
      Object.keys(shared.lines[0]).sort(),
      [
        "key",
        "name",
        "quantity",
        "basePriceMinor",
        "unitPriceMinor",
        "lineTotalMinor",
        "status",
        "options",
      ].sort(),
    );
  }));

test("both current and former history endpoints exclude closed visits", () =>
  tx(async () => {
    const first = await create(a);
    await identify(a);
    const oldSession = (await bill()).id;
    await complete(first.order);
    await manage("close", oldSession);
    await identify(a);
    let current = await call("get_guest_visit_order_history", ["mesa", token]);
    assert.equal(current.orders.length, 0);
    assert.equal(current.totals.orderValueMinor, 0);
    assert.equal(current.visit, null);
    const next = await create(a, 2);
    await create(b);
    await identify(a);
    current = await call("get_guest_visit_order_history", ["mesa", token]);
    assert.deepEqual(
      current.orders.map((o) => o.id),
      [next.order.id],
    );
    assert.equal(current.totals.orderValueMinor, 2800);
    assert.notEqual(current.visit.id, oldSession);
    const archive = await call("get_guest_order_history", ["mesa"]);
    assert.deepEqual(
      archive.orders.map((o) => o.id),
      [next.order.id],
    );
    await fails(
      () =>
        call("get_guest_visit_order_history", ["mesa", token, first.order.id]),
      "INVALID_REQUEST",
    );
    await identify(outsider);
    assert.equal(
      (await call("get_guest_visit_order_history", ["mesa", token])).orders
        .length,
      0,
    );
    await fails(
      () => call("get_guest_visit_order_history", ["mesa", randomUUID()]),
      "TABLE_INVALID",
    );
    await identify(staff, false);
    await fails(
      () => call("get_guest_visit_order_history", ["mesa", token]),
      "SESSION_REQUIRED",
    );
  }));
test("bill requests persist, deduplicate across guests and network retries, and acknowledge once with staff attribution", () =>
  tx(async () => {
    const { x, y, session } = await seeded();
    await change(x.order, "pending", "accepted");
    await change(y.order, "pending", "accepted");
    await identify(a);
    const request = await call("request_session_bill", ["mesa", session]);
    assert.equal(
      await call("request_session_bill", ["mesa", session]),
      request,
    );
    await identify(b);
    assert.equal(
      await call("request_session_bill", ["mesa", session]),
      request,
    );
    assert.equal((await bill()).request.status, "requested");
    await identify(staff, false);
    assert.equal((await workspace()).requests.length, 1);
    await manage("acknowledge", session);
    await manage("acknowledge", session);
    await identify(a);
    assert.equal((await bill()).request.status, "acknowledged");
    assert.equal(
      await call("request_session_bill", ["mesa", session]),
      request,
    );
    await admin();
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from private.session_events where session_id=$1 and action='bill_acknowledged' and actor_id=$2",
          [session, staff],
        )
      ).rows[0].n,
      1,
    );
  }));
test("close requires fulfilled orders and acknowledged requests, preserves history and removes current shared access", () =>
  tx(async () => {
    const { x, y, session } = await seeded();
    await fails(() => manage("close", session), "ACTIVE_ORDERS");
    await complete(x.order);
    await change(y.order, "pending", "cancelled", "Unavailable");
    await identify(a);
    await call("request_session_bill", ["mesa", session]);
    await fails(() => manage("close", session), "REQUEST_UNACKNOWLEDGED");
    await manage("acknowledge", session);
    assert.equal(await manage("close", session), session);
    assert.equal(await manage("close", session), session);
    await identify(a);
    const closed = await bill();
    assert.equal(closed, null);
    await fails(
      () => call("request_session_bill", ["mesa", session]),
      "PARTICIPATION_REQUIRED",
    );
    await identify(staff, false);
    const ws = await workspace();
    assert.equal(ws.tables.find((x) => x.id === t).session, null);
    assert.equal(ws.history[0].id, session);
    assert.equal(ws.requests.length, 0);
    const details = await call("get_staff_session_orders", [r, session]);
    assert.equal(details.orders.length, 2);
    assert.equal(
      details.orders.find((o) => o.id === x.order.id).items[0].options[0].name,
      "Toasted brioche",
    );
  }));
test("a new visit starts empty and cannot recover old orders or replay closed submissions", () =>
  tx(async () => {
    const x = await create();
    await identify(a);
    const oldSession = (await bill()).id;
    await complete(x.order);
    await manage("close", oldSession);
    const next = await manage("open");
    assert.notEqual(next, oldSession);
    assert.equal(
      (await workspace()).tables.find((x) => x.id === t).session.totals
        .orderValueMinor,
      0,
    );
    await identify(a);
    assert.equal(await bill(), null);
    assert.equal(
      (await db.query("select id from table_sessions")).rows.length,
      0,
    );
    await fails(
      () =>
        call("create_guest_order", [
          "mesa",
          token,
          JSON.stringify(x.items),
          x.key,
          x.review.reviewId,
        ]),
      "VISIT_ENDED",
    );
    const y = await create(b);
    await identify(staff, false);
    const details = await call("get_staff_session_orders", [r, next]);
    assert.equal(details.orders.length, 1);
    assert.equal(details.orders[0].id, y.order.id);
    await identify(a);
    await fails(
      () => call("request_session_bill", ["mesa", next]),
      "PARTICIPATION_REQUIRED",
    );
    assert.equal(await call("get_guest_order", ["mesa", x.order.id]), null);
    await admin();
    assert.equal(
      (
        await db.query("select session_id from orders where id=$1", [
          x.order.id,
        ])
      ).rows[0].session_id,
      oldSession,
    );
  }));
test("legacy orders are never backfilled, including idempotent retries", () =>
  tx(async () => {
    const legacy = randomUUID(),
      key = randomUUID(),
      items = [{ productId: product, quantity: 1, optionIds: [bread] }];
    const fingerprint = await call("private.order_request_fingerprint", [
      token,
      JSON.stringify(items),
    ]);
    await db.query(
      "insert into orders(id,restaurant_id,table_id,customer_id,currency,subtotal_minor,total_minor,restaurant_name,table_label,idempotency_key,request_fingerprint) values($1,$2,$3,$4,'EUR',1400,1400,'Casa Mesa','Table 04',$5,$6)",
      [legacy, r, t, a, key, fingerprint],
    );
    await create(b);
    await identify(a);
    await fails(
      () =>
        call("create_guest_order", [
          "mesa",
          token,
          JSON.stringify(items),
          key,
          randomUUID(),
        ]),
      "VISIT_ENDED",
    );
    await admin();
    assert.equal(
      (await db.query("select session_id from orders where id=$1", [legacy]))
        .rows[0].session_id,
      null,
    );
  }));
test("invalid, inactive and foreign QR tokens cannot create sessions or establish participation", () =>
  tx(async () => {
    await identify(a);
    await fails(
      () => call("get_guest_table_bill", ["mesa", randomUUID()]),
      "TABLE_INVALID",
    );
    await admin();
    await db.query("update dining_tables set is_active=false where id=$1", [t]);
    await identify(a);
    await fails(
      () => call("get_guest_table_bill", ["mesa", token]),
      "TABLE_INVALID",
    );
    assert.equal(
      (await db.query("select id from table_sessions")).rows.length,
      0,
    );
  }));
test("authorization and composite relationships prevent cross-restaurant session reads and staff actions", () =>
  tx(async () => {
    const { x, session } = await seeded();
    await change(x.order, "pending", "accepted");
    await identify(a);
    assert.equal(await call("get_guest_table_bill", ["session-other"]), null);
    await fails(
      () => call("request_session_bill", ["session-other", session]),
      "PARTICIPATION_REQUIRED",
    );
    await identify(staff, false);
    await fails(
      () => call("get_table_workspace", [foreign]),
      "STAFF_FORBIDDEN",
    );
    await fails(
      () => call("get_staff_session_orders", [foreign, session]),
      "STAFF_FORBIDDEN",
    );
    await fails(() => manage("close", session, t, foreign), "STAFF_FORBIDDEN");
  }));
test("direct writes and private legacy creation cannot bypass participation, session lifecycle or bill workflow", () =>
  tx(async () => {
    const { x, session } = await seeded();
    await change(x.order, "pending", "accepted");
    await identify(a);
    for (const sql of [
      "update table_sessions set status='closed' where id=$1",
      "insert into bill_requests(restaurant_id,session_id) values('11111111-1111-4111-8111-111111111111',$1)",
      "select * from private.session_participants where session_id=$1",
      "update private.session_participants set authorized_at=now() where session_id=$1",
    ])
      await fails(() => db.query(sql, [session]), "permission denied");
    await fails(
      () =>
        call("private.create_guest_order", [
          "mesa",
          token,
          JSON.stringify(x.items),
          randomUUID(),
          x.review.reviewId,
        ]),
      "permission denied",
    );
  }));
test("closed sessions reject new attached orders and future visits never expose their signals to previous guests", () =>
  tx(async () => {
    const x = await create();
    await identify(a);
    const session = (await bill()).id;
    await complete(x.order);
    await manage("close", session);
    const next = await manage("open");
    await admin();
    await fails(
      () =>
        db.query(
          "insert into orders(restaurant_id,table_id,customer_id,currency,subtotal_minor,total_minor,session_id) values($1,$2,$3,'EUR',0,0,$4)",
          [r, t, a, session],
        ),
      "SESSION_CLOSED",
    );
    await identify(a);
    const ids = (await db.query("select id from table_sessions")).rows.map(
      (s) => s.id,
    );
    assert.ok(!ids.includes(session) && !ids.includes(next));
  }));
test("bill request limits are durable per guest; existing request replays remain safe", () =>
  tx(async () => {
    const x = await create();
    await identify(a);
    const session = (await bill()).id;
    await change(x.order, "pending", "accepted");
    await admin();
    for (let i = 0; i < 3; i++)
      await db.query(
        "insert into private.session_events(restaurant_id,session_id,actor_id,action) values($1,$2,$3,'bill_requested')",
        [r, session, a],
      );
    await identify(a);
    await fails(
      () => call("request_session_bill", ["mesa", session]),
      "RATE_LIMITED",
    );
  }));
test("new session/request functions have safe grants and publications; none collect or verify payments", async () => {
  const functions = (
    await db.query(
      "select proname,proconfig,prosecdef,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') caller from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in('get_guest_table_bill','request_session_bill','manage_table_session','get_table_workspace','get_staff_session_orders')",
    )
  ).rows;
  assert.equal(functions.length, 5);
  assert.ok(
    functions.every(
      (f) =>
        f.prosecdef &&
        !f.anon &&
        f.caller &&
        f.proconfig.includes('search_path=""'),
    ),
  );
});

test("session setup failure rolls back the order, items, participants and newly opened visit", () =>
  tx(async () => {
    await db.exec(
      "create function private.fail_session_event() returns trigger language plpgsql as $$ begin raise exception 'EVENT_FAILED'; end $$;create trigger fail_session_event before insert on private.session_events for each row execute function private.fail_session_event()",
    );
    await identify(a);
    const items = [{ productId: product, quantity: 1, optionIds: [bread] }],
      key = randomUUID();
    const review = await call("review_guest_order", [
      "mesa",
      token,
      JSON.stringify(items),
    ]);
    await fails(
      () =>
        call("create_guest_order", [
          "mesa",
          token,
          JSON.stringify(items),
          key,
          review.reviewId,
        ]),
      "EVENT_FAILED",
    );
    await admin();
    for (const name of [
      "orders",
      "order_items",
      "table_sessions",
      "private.session_participants",
    ])
      assert.equal(
        (await db.query(`select count(*)::int n from ${name}`)).rows[0].n,
        0,
      );
    await db.exec("drop trigger fail_session_event on private.session_events");
    await identify(a);
    assert.ok(
      (
        await call("create_guest_order", [
          "mesa",
          token,
          JSON.stringify(items),
          key,
          review.reviewId,
        ])
      ).id,
    );
  }));
test("staff acceptance and participation authorization roll back together on an audit failure", () =>
  tx(async () => {
    const { x } = await seeded();
    await admin();
    await db.exec(
      "create function private.fail_participant() returns trigger language plpgsql as $$ begin if new.action='participant_authorized' then raise exception 'PARTICIPANT_FAILED'; end if;return new;end $$;create trigger fail_participant before insert on private.session_events for each row execute function private.fail_participant()",
    );
    await fails(
      () => change(x.order, "pending", "accepted"),
      "PARTICIPANT_FAILED",
    );
    await identify(a);
    assert.equal((await bill()).access, "waiting");
    assert.equal(
      (await call("get_guest_order", ["mesa", x.order.id])).status,
      "pending",
    );
  }));
test("bill request and closure audit failures leave no partial mutations", () =>
  tx(async () => {
    const x = await create();
    await identify(a);
    const session = (await bill()).id;
    await complete(x.order);
    await admin();
    await db.exec(
      "create function private.fail_bill_event() returns trigger language plpgsql as $$ begin if new.action in ('bill_requested','closed') then raise exception 'BILL_EVENT_FAILED'; end if;return new;end $$;create trigger fail_bill_event before insert on private.session_events for each row execute function private.fail_bill_event()",
    );
    await identify(a);
    await fails(
      () => call("request_session_bill", ["mesa", session]),
      "BILL_EVENT_FAILED",
    );
    assert.equal((await bill()).request, null);
    await fails(() => manage("close", session), "BILL_EVENT_FAILED");
    await identify(a);
    assert.equal((await bill()).access, "active");
  }));
test("staff session snapshots retain the visit currency even if trusted administration changes restaurant currency later", () =>
  tx(async () => {
    const x = await create();
    await complete(x.order);
    await identify(a);
    const session = (await bill()).id;
    await manage("close", session);
    await admin();
    await db.query("update restaurants set currency='USD' where id=$1", [r]);
    await identify(staff, false);
    assert.equal(
      (await workspace()).history.find((s) => s.id === session).currency,
      "EUR",
    );
  }));

test("staff read RPCs run in a read-only transaction as required by hosted PostgREST", async () => {
  await db.exec("begin read only");
  try {
    await identify(staff, false);
    assert.ok((await workspace()).tables.length);
    await fails(
      () => call("get_staff_session_orders", [r, randomUUID()]),
      "SESSION_NOT_FOUND",
    );
  } finally {
    await db.exec("rollback");
  }
});

test("a review from a closed visit cannot create an order in the next visit; a fresh review is required", () =>
  tx(async () => {
    const original = await create(a);
    await identify(a);
    const first = (await bill()).id;
    await identify(b);
    const items = [{ productId: product, quantity: 1, optionIds: [bread] }],
      key = randomUUID();
    const oldReview = await call("review_guest_order", [
      "mesa",
      token,
      JSON.stringify(items),
    ]);
    await complete(original.order);
    await manage("close", first);
    const second = await manage("open");
    await identify(b);
    await fails(
      () =>
        call("create_guest_order", [
          "mesa",
          token,
          JSON.stringify(items),
          key,
          oldReview.reviewId,
        ]),
      "SESSION_CHANGED",
    );
    await identify(staff, false);
    assert.equal(
      (await call("get_staff_session_orders", [r, second])).orders.length,
      0,
    );
    await identify(b);
    const fresh = await call("review_guest_order", [
      "mesa",
      token,
      JSON.stringify(items),
    ]);
    const placed = await call("create_guest_order", [
      "mesa",
      token,
      JSON.stringify(items),
      key,
      fresh.reviewId,
    ]);
    assert.ok(placed.id);
  }));
test("a review made before an intervening whole visit also requires refresh instead of silently starting another group", () =>
  tx(async () => {
    await identify(a);
    const items = [{ productId: product, quantity: 1, optionIds: [bread] }],
      key = randomUUID();
    const review = await call("review_guest_order", [
      "mesa",
      token,
      JSON.stringify(items),
    ]);
    const interim = await manage("open");
    await manage("close", interim);
    await identify(a);
    await fails(
      () =>
        call("create_guest_order", [
          "mesa",
          token,
          JSON.stringify(items),
          key,
          review.reviewId,
        ]),
      "SESSION_CHANGED",
    );
    await admin();
    assert.equal(
      (await db.query("select count(*)::int n from orders")).rows[0].n,
      0,
    );
  }));

test("closing a visit revokes every guest read path while staff retain complete historical snapshots", () =>
  tx(async () => {
    const x = await create(a),
      y = await create(a, 2);
    await identify(a);
    const session = (await bill()).id;
    assert.equal(
      (await call("get_guest_order_history", ["mesa"])).orders.length,
      2,
    );
    assert.equal(
      (await call("get_guest_order_progress", ["mesa", x.order.id])).id,
      x.order.id,
    );
    await complete(x.order);
    await complete(y.order);
    await manage("close", session);
    await identify(a);
    for (const table of [
      "orders",
      "order_items",
      "table_sessions",
      "bill_requests",
    ])
      assert.equal(
        (await db.query(`select * from public.${table}`)).rows.length,
        0,
        table,
      );
    assert.equal(await bill(), null);
    for (const order of [x, y]) {
      assert.equal(
        await call("get_guest_order", ["mesa", order.order.id]),
        null,
      );
      assert.equal(
        await call("get_guest_order", ["mesa", null, order.key]),
        null,
      );
      assert.equal(
        await call("get_guest_order_progress", ["mesa", order.order.id]),
        null,
      );
      await fails(
        () =>
          call("create_guest_order", [
            "mesa",
            token,
            JSON.stringify(order.items),
            order.key,
            order.review.reviewId,
          ]),
        "VISIT_ENDED",
      );
    }
    for (const name of [
      "get_guest_order_history",
      "get_guest_visit_order_history",
    ])
      assert.equal(
        (await call(name, ["mesa"])).totals.orderValueMinor,
        0,
        name,
      );
    await identify(staff, false);
    const records = await call("get_staff_session_orders", [r, session]);
    assert.equal(records.orders.length, 2);
    assert.equal(
      records.orders.reduce((sum, o) => sum + o.totalMinor, 0),
      4200,
    );
    assert.ok(
      records.orders.every(
        (o) => o.items[0].options[0].name === "Toasted brioche",
      ),
    );
    assert.equal((await workspace()).history[0].id, session);
  }));

test("the same anonymous identity starts fresh and cannot submit a stale cart or review into the next visit", () =>
  tx(async () => {
    await identify(a);
    const key = (
      await db.query("select * from resolve_table_visit($1,$2)", [
        "mesa",
        token,
      ])
    ).rows[0].visit_key;
    const x = await create(a);
    const session = (await bill()).id;
    const oldReview = await call("review_guest_order", [
      "mesa",
      token,
      JSON.stringify(x.items),
    ]);
    await complete(x.order);
    await manage("close", session);
    await identify(a);
    const nextKey = (
      await db.query("select * from resolve_table_visit($1,$2)", [
        "mesa",
        token,
      ])
    ).rows[0].visit_key;
    assert.notEqual(nextKey, key);
    await fails(
      () =>
        call("review_visit_order", [
          "mesa",
          token,
          JSON.stringify(x.items),
          key,
        ]),
      "SESSION_CHANGED",
    );
    await fails(
      () =>
        call("create_guest_order", [
          "mesa",
          token,
          JSON.stringify(x.items),
          randomUUID(),
          oldReview.reviewId,
        ]),
      "SESSION_CHANGED",
    );
    assert.equal(
      (await call("get_guest_visit_order_history", ["mesa", token])).orders
        .length,
      0,
    );
    const fresh = await create(a, 2);
    assert.deepEqual(
      (await call("get_guest_visit_order_history", ["mesa", token])).orders.map(
        (o) => o.id,
      ),
      [fresh.order.id],
    );
    assert.equal(await call("get_guest_order", ["mesa", x.order.id]), null);
    assert.equal((await bill()).access, "waiting");
  }));

test("deprecated unbound review and internal historical receipt helpers cannot be called by API roles", () =>
  tx(async () => {
    await identify(a);
    await fails(
      () =>
        db.query("select public.review_guest_order($1,$2,$3::jsonb)", [
          "mesa",
          token,
          JSON.stringify([
            { productId: product, quantity: 1, optionIds: [bread] },
          ]),
        ]),
      "permission denied",
    );
    await fails(
      () => call("private.get_guest_order", ["mesa", randomUUID()]),
      "permission denied",
    );
    await fails(
      () => call("private.session_bill_lines", [randomUUID()]),
      "permission denied",
    );
    await admin();
    const permissions = (
      await db.query(
        "select has_function_privilege('anon','public.review_visit_order(text,uuid,jsonb,uuid)','execute') anon,has_function_privilege('authenticated','public.review_guest_order(text,uuid,jsonb)','execute') legacy",
      )
    ).rows[0];
    assert.equal(permissions.anon, false);
    assert.equal(permissions.legacy, false);
  }));
