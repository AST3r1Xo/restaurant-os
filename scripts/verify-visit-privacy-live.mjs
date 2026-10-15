import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
nextEnv.loadEnvConfig(process.cwd(), true);
const clients = [],
  orders = [];
const check = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log("PASS " + message);
};
function client() {
  const c = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(15000) }),
      },
    },
  );
  clients.push(c);
  return c;
}
async function rpc(c, name, args) {
  const { data, error } = await c.rpc(name, args);
  if (error) throw new Error(name + " failed (" + error.code + ")");
  return data;
}
async function denied(c, name, args, code) {
  const { error } = await c.rpc(name, args);
  check(
    error?.message === code || error?.code === code,
    name + " rejects " + code,
  );
}
async function rows(c, table) {
  const result = await c.from(table).select("id");
  if (result.error) throw new Error(table + " query failed");
  return result.data;
}
async function until(test) {
  const end = Date.now() + 12000;
  while (!test()) {
    if (Date.now() > end) throw new Error("Realtime delivery timed out");
    await new Promise((r) => setTimeout(r, 80));
  }
}
async function main() {
  for (const key of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "STAFF_TEST_EMAIL",
    "STAFF_TEST_PASSWORD",
    "VISIT_PRIVACY_TABLE_TOKEN",
  ])
    check(!!process.env[key], key + " configured locally");
  const staff = client(),
    a = client(),
    b = client(),
    outsider = client(),
    token = process.env.VISIT_PRIVACY_TABLE_TOKEN;
  const login = await staff.auth.signInWithPassword({
    email: process.env.STAFF_TEST_EMAIL,
    password: process.env.STAFF_TEST_PASSWORD,
  });
  check(!login.error, "Trusted staff login works");
  const auth = await staff.auth.getUser();
  check(
    !!auth.data.user && !auth.data.user.is_anonymous,
    "Staff identity remotely verified",
  );
  const tableResult = await staff
    .from("dining_tables")
    .select("id,label,restaurant_id,is_active")
    .eq("qr_token", token)
    .single();
  check(
    !tableResult.error && tableResult.data?.label === "Bill QA",
    "Explicit isolated Bill QA table selected",
  );
  const table = tableResult.data,
    r = table.restaurant_id;
  let workspace = await rpc(staff, "get_table_workspace", {
    target_restaurant: r,
  });
  check(
    workspace.tables.find((t) => t.id === table.id)?.session === null,
    "QA table has no active visit; existing visits are never closed by this script",
  );
  if (!table.is_active) {
    const result = await staff
      .from("dining_tables")
      .update({ is_active: true })
      .eq("id", table.id);
    check(!result.error, "QA table activated for this explicit test");
  }
  for (const c of [a, b, outsider])
    check(
      !(await c.auth.signInAnonymously()).error,
      "Independent anonymous guest created",
    );
  const generation = async () =>
    (
      await rpc(a, "resolve_table_visit", {
        restaurant_slug: "mesa",
        table_token: token,
      })
    )[0].visit_key;
  const oldKey = await generation();
  const product = "44444444-4444-4444-8444-444444444441";
  const groups = await a
    .from("product_modifier_groups")
    .select("id")
    .eq("restaurant_id", r)
    .eq("product_id", product)
    .eq("name", "Your bread");
  const option = await a
    .from("modifier_options")
    .select("id")
    .eq("group_id", groups.data[0].id)
    .eq("name", "Toasted brioche");
  check(
    !groups.error && !option.error && !!option.data?.[0],
    "Live required customization available",
  );
  const intent = async (c, quantity) => {
    const items = [
      { productId: product, optionIds: [option.data[0].id], quantity },
    ];
    const review = await rpc(c, "review_visit_order", {
      restaurant_slug: "mesa",
      table_token: token,
      items,
      visit_key: await generation(),
    });
    return {
      restaurant_slug: "mesa",
      table_token: token,
      items,
      review_id: review.reviewId,
      idempotency_key: randomUUID(),
    };
  };
  const x = await intent(a, 1),
    y = await intent(a, 2),
    z = await intent(b, 1);
  for (const [c, request] of [
    [a, x],
    [a, y],
    [b, z],
  ])
    orders.push(await rpc(c, "create_guest_order", request));
  check(
    (await rows(a, "orders")).length === 2 &&
      (await rows(b, "orders")).length === 1,
    "Multiple own orders remain private during the active visit",
  );
  const current = await rpc(a, "get_guest_visit_order_history", {
      restaurant_slug: "mesa",
      table_token: token,
    }),
    sid = current.visit.id;
  check(
    current.orders.length === 2 &&
      current.totals.orderValueMinor ===
        orders[0].totalMinor + orders[1].totalMinor,
    "Current-visit PostgreSQL amounts cover both own orders",
  );
  check(
    (await rpc(outsider, "get_guest_table_bill", {
      restaurant_slug: "mesa",
      table_token: token,
    })) === null,
    "Shared QR alone never grants bill access",
  );
  const events = [];
  const channel = a.channel("visit-privacy:" + randomUUID(), {
    config: { postgres_changes_options: { wait: true, timeout: 15000 } },
  });
  for (const tableName of ["orders", "table_sessions", "bill_requests"])
    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: tableName,
        filter: "restaurant_id=eq." + r,
      },
      (e) =>
        events.push({ table: e.table, id: e.new.id, status: e.new.status }),
    );
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Realtime setup timed out")),
      20000,
    );
    channel.subscribe((s) => {
      if (s === "SUBSCRIBED") {
        clearTimeout(timer);
        resolve();
      } else if (s === "CHANNEL_ERROR") {
        clearTimeout(timer);
        reject(new Error("Realtime setup failed"));
      }
    });
  });
  const transition = (o, from, to) =>
    rpc(staff, "transition_order", {
      target_restaurant: r,
      target_order: o.id,
      expected_status: from,
      next_status: to,
    });
  for (const o of orders) await transition(o, "pending", "accepted");
  await until(() =>
    events.some((e) => e.id === orders[0].id && e.status === "accepted"),
  );
  const shared = await rpc(a, "get_guest_table_bill", {
    restaurant_slug: "mesa",
    table_token: token,
  });
  check(
    shared.lines.reduce((sum, l) => sum + l.quantity, 0) === 4,
    "Authorized itemized bill still combines every guest’s dishes",
  );
  const request = await rpc(a, "request_session_bill", {
    restaurant_slug: "mesa",
    target_session: sid,
  });
  await rpc(staff, "manage_table_session", {
    target_restaurant: r,
    target_table: table.id,
    operation: "acknowledge",
    target_session: sid,
  });
  await until(() =>
    events.some(
      (e) =>
        e.table === "bill_requests" &&
        e.id === request &&
        e.status === "acknowledged",
    ),
  );
  const stale = await intent(a, 1);
  for (const o of orders)
    for (const [from, to] of [
      ["accepted", "preparing"],
      ["preparing", "ready"],
      ["ready", "served"],
    ])
      await transition(o, from, to);
  await rpc(staff, "manage_table_session", {
    target_restaurant: r,
    target_table: table.id,
    operation: "close",
    target_session: sid,
  });
  for (const c of [a, b]) {
    for (const name of [
      "orders",
      "order_items",
      "table_sessions",
      "bill_requests",
    ])
      check(
        (await rows(c, name)).length === 0,
        "Same guest identity loses " + name + " reads after closure",
      );
    check(
      (await rpc(c, "get_guest_table_bill", {
        restaurant_slug: "mesa",
        table_token: token,
      })) === null,
      "Closed bill has no customer response",
    );
    for (const name of [
      "get_guest_order_history",
      "get_guest_visit_order_history",
    ])
      check(
        (await rpc(c, name, { restaurant_slug: "mesa" })).orders.length === 0,
        "No archive through " + name,
      );
  }
  for (const o of orders.slice(0, 2)) {
    check(
      (await rpc(a, "get_guest_order", {
        restaurant_slug: "mesa",
        order_id: o.id,
      })) === null,
      "Old receipt ID no longer resolves",
    );
    check(
      (await rpc(a, "get_guest_order_progress", {
        restaurant_slug: "mesa",
        order_id: o.id,
      })) === null,
      "Old tracking no longer resolves",
    );
  }
  check(
    (await rpc(a, "get_guest_order", {
      restaurant_slug: "mesa",
      idempotency_key: x.idempotency_key,
    })) === null,
    "Old idempotency recovery discloses no receipt",
  );
  await denied(a, "create_guest_order", x, "VISIT_ENDED");
  await denied(a, "create_guest_order", stale, "SESSION_CHANGED");
  await denied(
    a,
    "review_visit_order",
    {
      restaurant_slug: "mesa",
      table_token: token,
      items: x.items,
      visit_key: oldKey,
    },
    "SESSION_CHANGED",
  );
  await denied(
    a,
    "review_guest_order",
    { restaurant_slug: "mesa", table_token: token, items: x.items },
    "42501",
  );
  const historical = await rpc(staff, "get_staff_session_orders", {
    target_restaurant: r,
    target_session: sid,
  });
  check(
    historical.orders.length === 3 &&
      historical.orders.every(
        (o) => o.items[0].options[0].name === "Toasted brioche",
      ),
    "Authorized staff retain all historical orders and customization snapshots",
  );
  check(
    (await generation()) !== oldKey,
    "Closing atomically rotates the table visit generation",
  );
  const fresh = await rpc(staff, "manage_table_session", {
    target_restaurant: r,
    target_table: table.id,
    operation: "open",
  });
  check(
    (
      await rpc(staff, "get_staff_session_orders", {
        target_restaurant: r,
        target_session: fresh,
      })
    ).orders.length === 0,
    "Next visit has an empty bill",
  );
  check(
    (
      await rpc(a, "get_guest_visit_order_history", {
        restaurant_slug: "mesa",
        table_token: token,
      })
    ).orders.length === 0,
    "Previous anonymous identity has no inherited orders or participation",
  );
  await rpc(staff, "manage_table_session", {
    target_restaurant: r,
    target_table: table.id,
    operation: "close",
    target_session: fresh,
  });
  if (!table.is_active && process.env.KEEP_QA_ACTIVE !== "1")
    check(
      !(
        await staff
          .from("dining_tables")
          .update({ is_active: false })
          .eq("id", table.id)
      ).error,
      "QA table restored to its inactive state",
    );
  console.log(
    JSON.stringify({
      pass: true,
      sessionId: sid,
      orderIds: orders.map((o) => o.id),
      totalMinor: historical.orders.reduce((s, o) => s + o.totalMinor, 0),
      actualActiveVisitEvents: events.length,
      closedRequestId: request,
    }),
  );
}
try {
  await main();
} catch (e) {
  console.error("FAIL " + e.message);
  console.error(
    "Only this test’s created order IDs:",
    orders.map((o) => o.id),
  );
  process.exitCode = 1;
} finally {
  for (const c of clients) {
    await c.removeAllChannels();
    c.realtime.disconnect();
  }
}
