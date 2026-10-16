import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const r = "11111111-1111-4111-8111-111111111111",
  table = "22222222-2222-4222-8222-222222222221",
  product = "44444444-4444-4444-8444-444444444441";
const owner = randomUUID(),
  manager = randomUUID(),
  staff = randomUUID(),
  guest = randomUUID(),
  outsider = randomUUID(),
  foreign = randomUUID();
let token, bread;
before(async () => {
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema public,auth to anon,authenticated;create publication supabase_realtime;`);
  for (const name of (await readdir("supabase/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await db.exec(await readFile("supabase/migrations/" + name, "utf8"));
  await db.exec(await readFile("supabase/seed.sql", "utf8"));
  for (const id of [owner, manager, staff, guest, outsider])
    await db.query("insert into auth.users(id) values($1)", [id]);
  for (const [id, role] of [
    [owner, "owner"],
    [manager, "manager"],
    [staff, "staff"],
  ])
    await db.query(
      "insert into restaurant_members(restaurant_id,user_id,role) values($1,$2,$3)",
      [r, id, role],
    );
  await db.query(
    "insert into restaurants(id,slug,name,is_published) values($1,'opening-other','Other',true)",
    [foreign],
  );
  token = (
    await db.query("select qr_token from dining_tables where id=$1", [table])
  ).rows[0].qr_token;
  bread = (
    await db.query(
      "select id from modifier_options where name='Toasted brioche'",
    )
  ).rows[0].id;
});
after(() => db.close());
async function tx(fn) {
  await db.exec("begin");
  try {
    await fn();
  } finally {
    await db.exec("rollback");
  }
}
async function identify(id, anonymous = false) {
  await db.exec("reset role;set local role authenticated");
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
    [id, JSON.stringify({ sub: id, is_anonymous: anonymous })],
  );
}
async function rpc(name, args) {
  return (
    await db.query(
      `select ${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as value`,
      args,
    )
  ).rows[0].value;
}
async function denied(fn, message) {
  await db.exec("savepoint denial");
  try {
    await assert.rejects(fn, new RegExp(message));
  } finally {
    await db.exec("rollback to savepoint denial");
  }
}
const items = () =>
  JSON.stringify([{ productId: product, quantity: 1, optionIds: [bread] }]);
async function review() {
  const visit = (
    await db.query("select * from resolve_table_visit($1,$2)", ["mesa", token])
  ).rows[0];
  return rpc("review_visit_order", ["mesa", token, items(), visit.visit_key]);
}
async function opened(next, expected = !next, id = r) {
  return rpc("set_restaurant_open", [id, expected, next]);
}

test("only owners/managers can change OPEN/CLOSED and conflicting changes fail", () =>
  tx(async () => {
    await identify(owner);
    assert.equal((await opened(false)).isOpen, false);
    await denied(() => opened(false), "MENU_CONFLICT");
    await identify(manager);
    assert.equal((await opened(true)).isOpen, true);
    for (const [id, anon] of [
      [staff, false],
      [guest, true],
      [outsider, false],
    ]) {
      await identify(id, anon);
      await denied(
        () => opened(false),
        "MANAGER_REQUIRED|STAFF_FORBIDDEN|STAFF_REQUIRED",
      );
    }
    await identify(owner);
    await denied(() => opened(false, true, foreign), "STAFF_FORBIDDEN");
  }));
test("CLOSED rejects new orders and sessions but preserves current guest service, kitchen and history", () =>
  tx(async () => {
    await identify(guest, true);
    const quote = await review(),
      key = randomUUID();
    const order = await rpc("create_guest_order", [
      "mesa",
      token,
      items(),
      key,
      quote.reviewId,
    ]);
    const nextQuote = await review();
    await identify(owner);
    await opened(false);
    const tables = await rpc("get_table_workspace", [r]);
    const active = tables.tables.find((t) => t.id === table).session;
    assert.equal(active.status, "active");
    const emptyTable = tables.tables.find((t) => !t.session);
    await denied(
      () => rpc("manage_table_session", [r, emptyTable.id, "open", null]),
      "RESTAURANT_UNAVAILABLE",
    );
    await identify(guest, true);
    await denied(() => review(), "RESTAURANT_UNAVAILABLE");
    await denied(
      () =>
        rpc("create_guest_order", [
          "mesa",
          token,
          items(),
          randomUUID(),
          nextQuote.reviewId,
        ]),
      "RESTAURANT_UNAVAILABLE",
    );
    assert.equal(
      (
        await rpc("create_guest_order", [
          "mesa",
          token,
          items(),
          key,
          quote.reviewId,
        ])
      ).id,
      order.id,
    );
    assert.equal(
      (await rpc("get_guest_order", ["mesa", order.id, null])).id,
      order.id,
    );
    assert.equal(
      (await rpc("get_guest_visit_order_history", ["mesa", token, null])).totals
        .orderCount,
      1,
    );
    await identify(staff);
    await rpc("transition_order", [r, order.id, "pending", "accepted", null]);
    await identify(guest, true);
    assert.equal(
      (await rpc("get_guest_table_bill", ["mesa", token])).totals
        .confirmedMinor,
      1400,
    );
    await rpc("request_session_bill", ["mesa", active.id]);
    await identify(staff);
    await rpc("manage_table_session", [r, table, "acknowledge", active.id]);
    for (const [from, to] of [
      ["accepted", "preparing"],
      ["preparing", "ready"],
      ["ready", "served"],
    ])
      await rpc("transition_order", [r, order.id, from, to, null]);
    await rpc("manage_table_session", [r, table, "close", active.id]);
    assert.equal(
      (await rpc("get_staff_session_orders", [r, active.id, null])).orders[0]
        .id,
      order.id,
    );
    await identify(guest, true);
    assert.equal(await rpc("get_guest_order", ["mesa", order.id, null]), null);
    await identify(owner);
    await opened(true);
    const fresh = await rpc("manage_table_session", [r, table, "open", null]);
    assert.notEqual(fresh, active.id);
    assert.equal(
      (await rpc("get_table_workspace", [r])).tables.find((t) => t.id === table)
        .session.totals.orderValueMinor,
      0,
    );
    await identify(guest, true);
    assert.ok((await review()).reviewId);
  }));
test("closed-session guard applies to direct inserts, without closing existing visits", () =>
  tx(async () => {
    await identify(owner);
    const session = await rpc("manage_table_session", [r, table, "open", null]);
    await opened(false);
    await db.exec("reset role");
    assert.equal(
      (
        await db.query("select status from table_sessions where id=$1", [
          session,
        ])
      ).rows[0].status,
      "active",
    );
    const nextTable = (
      await db.query(
        "select id from dining_tables where restaurant_id=$1 and id<>$2 limit 1",
        [r, table],
      )
    ).rows[0].id;
    await denied(
      () =>
        db.query(
          "insert into table_sessions(restaurant_id,table_id,table_label,currency) values($1,$2,'Direct','EUR')",
          [r, nextTable],
        ),
      "RESTAURANT_UNAVAILABLE",
    );
  }));
test("five active Casa Mesa QR codes are distinct, resolve correctly and retain their identities on setup rerun", () =>
  tx(async () => {
    const rows = (
      await db.query(
        "select id,label,qr_token from dining_tables where restaurant_id=$1 and is_active order by label",
        [r],
      )
    ).rows;
    assert.deepEqual(
      rows.map((t) => t.label),
      ["Table 01", "Table 02", "Table 03", "Table 04", "Table 05"],
    );
    assert.equal(new Set(rows.map((t) => t.qr_token)).size, 5);
    for (const t of rows) {
      const resolved = (
        await db.query("select * from resolve_table_visit($1,$2)", [
          "mesa",
          t.qr_token,
        ])
      ).rows;
      assert.equal(resolved[0].table_label, t.label);
      assert.equal(
        (
          await db.query("select * from resolve_table_visit($1,$2)", [
            "opening-other",
            t.qr_token,
          ])
        ).rows.length,
        0,
      );
    }
    await db.exec(
      (
        await readFile(
          "supabase/migrations/20261016100017_five_casa_mesa_tables.sql",
          "utf8",
        )
      )
        .replace(/^begin;/, "")
        .replace(/commit;\s*$/, ""),
    );
    assert.deepEqual(
      (
        await db.query(
          "select id,label,qr_token from dining_tables where restaurant_id=$1 and is_active order by label",
          [r],
        )
      ).rows,
      rows,
    );
  }));
test("QR tokens cannot be enumerated by API roles; only managers receive their own QR list", () =>
  tx(async () => {
    for (const [id, anon] of [
      [owner, false],
      [manager, false],
      [staff, false],
      [guest, true],
      [outsider, false],
    ]) {
      await identify(id, anon);
      await denied(
        () => db.query("select qr_token from dining_tables"),
        "permission denied",
      );
      if ([owner, manager].includes(id))
        assert.equal(
          (await db.query("select * from get_table_qr_codes($1)", [r])).rows
            .length,
          5,
        );
      else
        await denied(
          () => db.query("select * from get_table_qr_codes($1)", [r]),
          "MANAGER_REQUIRED|STAFF_FORBIDDEN|STAFF_REQUIRED",
        );
    }
    await identify(owner);
    await denied(
      () => db.query("select * from get_table_qr_codes($1)", [foreign]),
      "STAFF_FORBIDDEN",
    );
  }));
test("QR rotation rejects stale and occupied tables; old codes stop resolving, visits and snapshots stay intact", () =>
  tx(async () => {
    await identify(owner);
    const t = (
      await db.query("select * from get_table_qr_codes($1)", [r])
    ).rows.find((t) => t.id === table);
    const active = await rpc("manage_table_session", [r, table, "open", null]);
    await denied(
      () => rpc("rotate_table_qr", [r, table, t.updated_at]),
      "TABLE_OCCUPIED",
    );
    await rpc("manage_table_session", [r, table, "close", active]);
    const current = (
      await db.query("select * from get_table_qr_codes($1)", [r])
    ).rows.find((t) => t.id === table);
    await rpc("rotate_table_qr", [r, table, current.updated_at]);
    const rotated = (
      await db.query("select * from get_table_qr_codes($1)", [r])
    ).rows.find((t) => t.id === table);
    assert.notEqual(rotated.qr_token, token);
    assert.equal(
      (
        await db.query("select * from resolve_table_visit($1,$2)", [
          "mesa",
          token,
        ])
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query("select * from resolve_table_visit($1,$2)", [
          "mesa",
          rotated.qr_token,
        ])
      ).rows[0].table_label,
      "Table 04",
    );
    await denied(
      () => rpc("rotate_table_qr", [r, table, new Date(0)]),
      "MENU_CONFLICT",
    );
    await denied(
      () =>
        db.query(
          "update dining_tables set qr_token=gen_random_uuid() where id=$1",
          [table],
        ),
      "permission denied",
    );
    await denied(
      () => rpc("rotate_table_qr", [foreign, table, rotated.updated_at]),
      "STAFF_FORBIDDEN",
    );
    for (const [id, anon] of [
      [staff, false],
      [guest, true],
    ]) {
      await identify(id, anon);
      await denied(
        () => rpc("rotate_table_qr", [r, table, rotated.updated_at]),
        "MANAGER_REQUIRED|STAFF_REQUIRED",
      );
    }
  }));
test("opening hours are informational and validated; manual status remains authoritative", () =>
  tx(async () => {
    await identify(owner);
    const workspace = await rpc("menu_workspace", [r]),
      v = workspace.restaurant;
    const definition = {
      name: v.name,
      description: v.description,
      timezone: v.timezone,
      is_published: true,
      is_accepting_orders: false,
      opening_hours: "Tue-Sun 19:00-23:00",
      logo_asset_id: null,
      cover_asset_id: null,
      keep_legacy_logo: true,
      keep_legacy_cover: true,
    };
    await rpc("save_restaurant_presentation", [
      r,
      v.updated_at,
      JSON.stringify(definition),
    ]);
    const next = (await rpc("menu_workspace", [r])).restaurant;
    assert.equal(next.opening_hours, definition.opening_hours);
    assert.equal(next.is_accepting_orders, false);
    await denied(
      () =>
        rpc("save_restaurant_presentation", [
          r,
          next.updated_at,
          JSON.stringify({ ...definition, opening_hours: "x".repeat(1001) }),
        ]),
      "MENU_INVALID",
    );
  }));
test("new definer functions have safe search paths and no anonymous execution", async () => {
  const rows = (
    await db.query(
      "select proname,proconfig,prosecdef,has_function_privilege('anon',p.oid,'execute') as anon from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in('set_restaurant_open','get_table_qr_codes','rotate_table_qr')",
    )
  ).rows;
  assert.equal(rows.length, 3);
  for (const f of rows) {
    assert.equal(f.prosecdef, true);
    assert.equal(f.anon, false);
    assert.ok(f.proconfig.some((c) => c.startsWith("search_path=")));
  }
});

test("five-table setup cannot reconfigure an unrelated restaurant that uses the Mesa slug", () =>
  tx(async () => {
    await db.query("update restaurants set slug='seed-mesa' where id=$1", [r]);
    const unrelated = randomUUID();
    await db.query(
      "insert into restaurants(id,slug,name) values($1,'mesa','Unrelated Mesa')",
      [unrelated],
    );
    await db.query(
      "insert into dining_tables(restaurant_id,label) values($1,'Private room')",
      [unrelated],
    );
    const script = (
      await readFile(
        "supabase/migrations/20261016100017_five_casa_mesa_tables.sql",
        "utf8",
      )
    )
      .replace(/^begin;/, "")
      .replace(/commit;\s*$/, "");
    await db.exec(script);
    const tables = (
      await db.query(
        "select label,is_active from dining_tables where restaurant_id=$1",
        [unrelated],
      )
    ).rows;
    assert.deepEqual(tables, [{ label: "Private room", is_active: true }]);
  }));
test("five-table setup refuses to displace an occupied extra test table", () =>
  tx(async () => {
    const extra = (
      await db.query(
        "insert into dining_tables(restaurant_id,label) values($1,'Occupied QA') returning id",
        [r],
      )
    ).rows[0].id;
    await db.query(
      "insert into table_sessions(restaurant_id,table_id,table_label,currency) values($1,$2,'Occupied QA','EUR')",
      [r, extra],
    );
    const script = (
      await readFile(
        "supabase/migrations/20261016100017_five_casa_mesa_tables.sql",
        "utf8",
      )
    )
      .replace(/^begin;/, "")
      .replace(/commit;\s*$/, "");
    await denied(() => db.exec(script), "occupied extra table");
    assert.equal(
      (
        await db.query("select is_active from dining_tables where id=$1", [
          extra,
        ])
      ).rows[0].is_active,
      true,
    );
  }));
