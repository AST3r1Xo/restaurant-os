// Explicit development-only workflow. Creates only an isolated QA restaurant,
// menu/table records and real retained QA orders. Never touches occupied tables.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { staffCookieOptions } from "../src/lib/supabase/staff-cookie.ts";
import { guestCookieOptions } from "../src/lib/supabase/guest-cookie.ts";
import { submitWithRecovery } from "../src/features/orders/repository.ts";
import { qaAdminKey } from "./qa-admin.mjs";
if (process.env.CONFIRM_PILOT_QA !== "development")
  throw new Error(
    "Set CONFIRM_PILOT_QA=development for isolated retained QA records.",
  );
const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (new URL(url).hostname !== `${process.env.PILOT_QA_PROJECT_REF}.supabase.co`)
  throw new Error(
    "Set PILOT_QA_PROJECT_REF to the intended development project.",
  );
const origin = process.env.PILOT_TEST_ORIGIN ?? "http://localhost:3000";
const clients = [],
  orders = [],
  checks = [];
let loseResponse = false;
const service = createClient(url, qaAdminKey(url), {
  auth: { persistSession: false, autoRefreshToken: false },
});
function client(staff = false) {
  const jar = new Map();
  const c = createServerClient(url, key, {
    cookieOptions: staff ? staffCookieOptions(url) : guestCookieOptions(url),
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (xs) => xs.forEach((x) => jar.set(x.name, x.value)),
    },
    global: {
      fetch: async (input, init) => {
        const response = await fetch(input, {
          ...init,
          signal: AbortSignal.timeout(15000),
        });
        if (
          loseResponse &&
          String(input).endsWith("/rpc/create_guest_order") &&
          response.ok
        ) {
          loseResponse = false;
          throw new Error("simulated committed response loss");
        }
        return response;
      },
    },
  });
  clients.push(c);
  return {
    c,
    jar,
    cookie: () =>
      [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; "),
  };
}
async function ok(p, label = "Database request") {
  const { data, error } = await p;
  if (error)
    throw new Error(
      `${label} failed (${error.code ?? error.status ?? "unavailable"})`,
    );
  return data;
}
function check(value, label) {
  assert.ok(value, label);
  checks.push(label);
  console.log("PASS " + label);
}
async function rpc(c, name, args) {
  return ok(c.rpc(name, args), name);
}
async function denied(c, name, args, code) {
  const { error } = await c.rpc(name, args);
  check(
    !!error && (!code || error.message === code || error.code === code),
    `${name} denies ${code ?? "unauthorized access"}`,
  );
}
async function wait(test, label) {
  const end = Date.now() + 15000;
  while (!test()) {
    if (Date.now() > end) throw new Error("Realtime timeout: " + label);
    await new Promise((r) => setTimeout(r, 100));
  }
  check(true, label);
}
async function subscribe(c, r, events) {
  const channel = c.channel("pilot:" + randomUUID(), {
    config: { postgres_changes_options: { wait: true, timeout: 15000 } },
  });
  for (const table of ["orders", "table_sessions", "bill_requests"])
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table, filter: `restaurant_id=eq.${r}` },
      (e) =>
        events.push({ table: e.table, id: e.new.id, status: e.new.status }),
    );
  await new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error("Realtime readiness timed out")),
      20000,
    );
    channel.subscribe((s) => {
      if (s === "SUBSCRIBED") {
        clearTimeout(t);
        resolve();
      } else if (s === "CHANNEL_ERROR") {
        clearTimeout(t);
        reject(new Error("Realtime subscription failed"));
      }
    });
  });
  return channel;
}
const staff = client(true),
  a = client(),
  b = client(),
  outsider = client();
const r = randomUUID(),
  other = randomUUID(),
  table = randomUUID(),
  token = randomUUID(),
  category = randomUUID(),
  product = randomUUID(),
  group = randomUUID(),
  option = randomUUID(),
  foreignProduct = randomUUID(),
  foreignCategory = randomUUID();
const slug = "pilot-qa-" + r.slice(0, 8),
  createdAt = new Date().toISOString();
let provisioned = false;
async function change(o, from, to) {
  return rpc(staff.c, "transition_order", {
    target_restaurant: r,
    target_order: o.id,
    expected_status: from,
    next_status: to,
    ...(to === "cancelled" ? { reason: "Isolated pilot verification" } : {}),
  });
}
async function workspace() {
  return rpc(staff.c, "get_table_workspace", { target_restaurant: r });
}
async function bill(c) {
  return rpc(c, "get_guest_table_bill", {
    restaurant_slug: slug,
    table_token: token,
  });
}
async function intent(c, qty, visit) {
  const items = [{ productId: product, optionIds: [option], quantity: qty }];
  const key =
    visit ??
    (
      await rpc(c, "resolve_table_visit", {
        restaurant_slug: slug,
        table_token: token,
      })
    )[0].visit_key;
  const review = await rpc(c, "review_visit_order", {
    restaurant_slug: slug,
    table_token: token,
    visit_key: key,
    items,
  });
  return {
    restaurant_slug: slug,
    table_token: token,
    items,
    review_id: review.reviewId,
    idempotency_key: randomUUID(),
    visitKey: key,
  };
}
const args = (i) => ({
  restaurant_slug: i.restaurant_slug,
  table_token: i.table_token,
  items: i.items,
  review_id: i.review_id,
  idempotency_key: i.idempotency_key,
});
try {
  const auth = await ok(
    staff.c.auth.signInWithPassword({
      email: process.env.STAFF_TEST_EMAIL,
      password: process.env.STAFF_TEST_PASSWORD,
    }),
    "Staff login",
  );
  check(!auth.user.is_anonymous, "Existing confirmed staff signs in");
  await ok(
    service.from("restaurants").insert([
      {
        id: r,
        slug,
        name: "Pilot verification QA",
        is_published: true,
        is_accepting_orders: true,
      },
      {
        id: other,
        slug: "pilot-private-" + other.slice(0, 8),
        name: "Unrelated isolated QA",
        is_published: false,
        is_accepting_orders: false,
      },
    ]),
  );
  provisioned = true;
  await ok(
    service
      .from("restaurant_members")
      .insert({ restaurant_id: r, user_id: auth.user.id, role: "owner" }),
  );
  staff.jar.set("restaurant-os-workspace", r);
  await ok(
    service.from("dining_tables").insert({
      id: table,
      restaurant_id: r,
      label: "Pilot QA table",
      qr_token: token,
    }),
  );
  await ok(
    service.from("menu_categories").insert([
      { id: category, restaurant_id: r, name: "Pilot dishes", is_active: true },
      {
        id: foreignCategory,
        restaurant_id: other,
        name: "Private dishes",
        is_active: true,
      },
    ]),
  );
  await ok(
    service.from("products").insert([
      {
        id: product,
        restaurant_id: r,
        category_id: category,
        name: "Pilot QA dish",
        price_minor: 1200,
        is_published: true,
      },
      {
        id: foreignProduct,
        restaurant_id: other,
        category_id: foreignCategory,
        name: "Unrelated private dish",
        price_minor: 900,
        is_published: false,
      },
    ]),
  );
  await ok(
    service.from("product_modifier_groups").insert({
      id: group,
      restaurant_id: r,
      product_id: product,
      name: "Pilot choice",
      min_selections: 1,
      max_selections: 1,
      selection_type: "single",
    }),
  );
  await ok(
    service.from("modifier_options").insert({
      id: option,
      restaurant_id: r,
      group_id: group,
      name: "Pilot supplement",
      price_adjustment_minor: 100,
    }),
  );
  for (const g of [a, b, outsider])
    await ok(g.c.auth.signInAnonymously(), "Anonymous guest");
  const settings = await fetch(url + "/auth/v1/settings", {
    headers: { apikey: key },
  }).then((r) => r.json());
  check(
    settings.external?.anonymous_users === true,
    "Hosted anonymous authentication enabled",
  );
  const bucket = await ok(
    service.storage.getBucket("restaurant-media"),
    "Storage configuration",
  );
  check(
    bucket.public &&
      Number(bucket.file_size_limit) === 4000000 &&
      bucket.allowed_mime_types.includes("model/gltf-binary"),
    "Hosted media restrictions present",
  );
  const se = [],
    ae = [],
    be = [],
    oe = [];
  await Promise.all(
    [
      [staff.c, se],
      [a.c, ae],
      [b.c, be],
      [outsider.c, oe],
    ].map(([c, e]) => subscribe(c, r, e)),
  );
  const [ia, ib] = await Promise.all([intent(a.c, 1), intent(b.c, 2)]);
  const submitted = await Promise.all([
    rpc(a.c, "create_guest_order", args(ia)),
    rpc(a.c, "create_guest_order", args(ia)),
    rpc(b.c, "create_guest_order", args(ib)),
  ]);
  const [oa, duplicate, ob] = submitted;
  orders.push(oa.id, ob.id);
  check(
    oa.id === duplicate.id && oa.totalMinor === 1300 && ob.totalMinor === 2600,
    "Concurrent submissions use trusted customized totals and persistent idempotency",
  );
  const initial = await workspace(),
    session = initial.tables[0].session;
  check(
    session.totals.orderCount === 2 && session.totals.pendingMinor === 3900,
    "Two guests share exactly one active session",
  );
  check(
    (await bill(a.c)).access === "waiting" && !(await bill(b.c)).totals,
    "Pending guests have no unauthorized shared totals",
  );
  await wait(
    () => se.some((e) => e.id === oa.id) && se.some((e) => e.id === ob.id),
    "Open staff subscription receives both new orders",
  );
  const race = await Promise.all([
    staff.c.rpc("transition_order", {
      target_restaurant: r,
      target_order: oa.id,
      expected_status: "pending",
      next_status: "accepted",
    }),
    staff.c.rpc("transition_order", {
      target_restaurant: r,
      target_order: oa.id,
      expected_status: "pending",
      next_status: "accepted",
    }),
  ]);
  check(
    race.filter((x) => !x.error).length === 1 &&
      race.some((x) => x.error?.message === "STATUS_CONFLICT"),
    "Concurrent staff actions commit one valid transition",
  );
  await wait(
    () => ae.some((e) => e.id === oa.id && e.status === "accepted"),
    "Guest receives its accepted order event",
  );
  let shared = await bill(a.c);
  check(
    shared.totals.confirmedMinor === 1300 &&
      shared.totals.pendingMinor === 2600 &&
      shared.lines.length === 2,
    "Itemized shared bill separates pending and accepted recorded values",
  );
  await change(ob, "pending", "accepted");
  shared = await bill(b.c);
  check(
    shared.totals.confirmedMinor === 3900 && shared.lines[0].quantity === 3,
    "Both accepted guests see all ordered dishes and supplements",
  );
  check(
    (await rpc(a.c, "get_guest_order", {
      restaurant_slug: slug,
      order_id: ob.id,
    })) === null && (await bill(outsider.c)) === null,
    "Shared QR and bill access never grant another guest private receipts",
  );
  for (const g of [a, b]) {
    const own = await ok(
      g.c.from("orders").select("id").eq("restaurant_id", r),
    );
    check(
      own.length === 1,
      "Direct order RLS exposes only the current guest’s own order",
    );
  }
  await denied(
    a.c,
    "review_visit_order",
    {
      restaurant_slug: slug,
      table_token: randomUUID(),
      visit_key: ia.visitKey,
      items: ia.items,
    },
    "TABLE_INVALID",
  );
  await denied(
    a.c,
    "review_visit_order",
    {
      restaurant_slug: slug,
      table_token: token,
      visit_key: ia.visitKey,
      items: [{ productId: foreignProduct, optionIds: [], quantity: 1 }],
    },
    "PRODUCT_UNAVAILABLE",
  );
  await denied(
    staff.c,
    "get_table_workspace",
    { target_restaurant: other },
    "STAFF_FORBIDDEN",
  );
  const forged = await a.c
    .from("orders")
    .update({ total_minor: 1 })
    .eq("id", oa.id);
  check(!!forged.error, "Guests cannot directly rewrite totals");
  const receipt = await fetch(
    `${origin}/r/${slug}/orders/${oa.id}?table=${token}`,
    { headers: { cookie: a.cookie() }, redirect: "manual" },
  );
  check(
    receipt.status === 200 && (await receipt.text()).includes("Pilot QA dish"),
    "Server confirmation URL returns an authorized real order",
  );
  const denyReceipt = await fetch(
    `${origin}/r/${slug}/orders/${oa.id}?table=${token}`,
    { headers: { cookie: b.cookie() }, redirect: "manual" },
  );
  check(
    denyReceipt.status === 404,
    "Another guest receives HTTP 404 for a private confirmation",
  );
  const cancelIntent = await intent(b.c, 1);
  loseResponse = true;
  const recovered = await submitWithRecovery(b.c, {
    restaurantSlug: slug,
    tableToken: token,
    visitKey: cancelIntent.visitKey,
    items: cancelIntent.items,
    idempotencyKey: cancelIntent.idempotency_key,
    reviewId: cancelIntent.review_id,
  });
  orders.push(recovered.id);
  check(
    !!recovered.id,
    "A lost committed response is recovered by the original idempotency key",
  );
  await change(recovered, "pending", "cancelled");
  check(
    (await bill(a.c)).totals.orderValueMinor === 3900,
    "Cancelled order is excluded from shared recorded value",
  );
  const requests = await Promise.all(
    [a, b].map((g) =>
      rpc(g.c, "request_session_bill", {
        restaurant_slug: slug,
        target_session: session.id,
      }),
    ),
  );
  check(
    requests[0] === requests[1],
    "Simultaneous bill requests persist one request",
  );
  await wait(
    () => se.some((e) => e.id === requests[0] && e.table === "bill_requests"),
    "Staff receives the real bill-request event",
  );
  const manage = (operation) =>
    rpc(staff.c, "manage_table_session", {
      target_restaurant: r,
      target_table: table,
      target_session: session.id,
      operation,
    });
  await manage("acknowledge");
  await wait(
    () =>
      ae.some((e) => e.id === requests[0] && e.status === "acknowledged") &&
      be.some((e) => e.id === requests[0] && e.status === "acknowledged"),
    "Both guests receive staff acknowledgement",
  );
  await denied(
    staff.c,
    "manage_table_session",
    {
      target_restaurant: r,
      target_table: table,
      target_session: session.id,
      operation: "close",
    },
    "ACTIVE_ORDERS",
  );
  await staff.c.removeAllChannels();
  for (const o of [oa, ob])
    for (const [from, to] of [
      ["accepted", "preparing"],
      ["preparing", "ready"],
      ["ready", "served"],
    ]) {
      await change(o, from, to);
      await wait(
        () =>
          (o.id === oa.id ? ae : be).some(
            (e) => e.id === o.id && e.status === to,
          ),
        `Guest status propagates ${to}`,
      );
    }
  await subscribe(staff.c, r, se);
  const reconciled = await rpc(staff.c, "get_kitchen_snapshot", {
    target_restaurant: r,
  });
  check(
    reconciled.orders
      .filter((o) => orders.includes(o.id))
      .every((o) => ["served", "cancelled"].includes(o.status)),
    "Reconnected staff refetches authoritative final states",
  );
  const stale = await intent(a.c, 1);
  await manage("close");
  check(
    (await rpc(a.c, "get_guest_order", {
      restaurant_slug: slug,
      order_id: oa.id,
    })) === null && (await bill(a.c)) === null,
    "Session closure revokes receipt and shared bill access",
  );
  check(
    (await ok(a.c.from("orders").select("id").eq("restaurant_id", r)))
      .length === 0,
    "Old anonymous identity cannot read historical rows directly",
  );
  const history = await rpc(a.c, "get_guest_visit_order_history", {
    restaurant_slug: slug,
    table_token: token,
  });
  check(
    history.orders.length === 0 && history.totals.orderValueMinor === 0,
    "Current-order API contains no past visit",
  );
  const oldUrl = await fetch(
    `${origin}/r/${slug}/orders/${oa.id}?table=${token}`,
    { headers: { cookie: a.cookie() }, redirect: "manual" },
  );
  check(
    oldUrl.status === 404,
    "Previous confirmation URL returns HTTP 404 after closure",
  );
  await denied(a.c, "create_guest_order", args(ia), "VISIT_ENDED");
  await denied(a.c, "create_guest_order", args(stale), "SESSION_CHANGED");
  const record = await rpc(staff.c, "get_staff_session_orders", {
    target_restaurant: r,
    target_session: session.id,
  });
  check(
    record.orders.length === 3 &&
      record.orders.every(
        (o) => o.items[0].options[0].name === "Pilot supplement",
      ),
    "Staff retains complete historical customized snapshots",
  );
  const next = await rpc(staff.c, "manage_table_session", {
    target_restaurant: r,
    target_table: table,
    operation: "open",
  });
  check(
    next !== session.id &&
      (await workspace()).tables[0].session.totals.orderValueMinor === 0,
    "Next visit begins with an empty bill",
  );
  const nextIntent = await intent(a.c, 1),
    newOrder = await rpc(a.c, "create_guest_order", args(nextIntent));
  orders.push(newOrder.id);
  check(
    (
      await rpc(a.c, "get_guest_visit_order_history", {
        restaurant_slug: slug,
        table_token: token,
      })
    ).orders.length === 1,
    "The same guest’s new visit excludes all earlier orders",
  );
  await change(newOrder, "pending", "cancelled");
  await rpc(staff.c, "manage_table_session", {
    target_restaurant: r,
    target_table: table,
    target_session: next,
    operation: "close",
  });
  check(
    !oe.some((e) =>
      ["orders", "table_sessions", "bill_requests"].includes(e.table),
    ),
    "Unaffiliated guest receives no private Realtime rows",
  );
  await writeFile(
    "/private/tmp/restaurant-os-pilot-live.json",
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        createdAt,
        restaurantId: r,
        otherRestaurantId: other,
        tableId: table,
        slug,
        checks: checks.length,
        results: checks,
        orders,
        isolated: true,
        sessionClosed: true,
        browserTest: false,
        physicalDeviceTest: false,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  if (provisioned) {
    // Never delete historical QA records. Best-effort cleanup only this run's tenant.
    try {
      const pending = await ok(
        staff.c.from("orders").select("id,status").eq("restaurant_id", r),
      );
      for (const o of pending) {
        if (o.status === "pending") await change(o, "pending", "cancelled");
        else if (!["served", "cancelled"].includes(o.status)) {
          const path = ["accepted", "preparing", "ready", "served"];
          for (let i = path.indexOf(o.status); i < path.length - 1; i++)
            await change(o, path[i], path[i + 1]);
        }
      }
      const ws = await workspace();
      for (const t of ws.tables)
        if (t.session) {
          if (t.session.request?.status === "requested")
            await rpc(staff.c, "manage_table_session", {
              target_restaurant: r,
              target_table: t.id,
              target_session: t.session.id,
              operation: "acknowledge",
            });
          await rpc(staff.c, "manage_table_session", {
            target_restaurant: r,
            target_table: t.id,
            target_session: t.session.id,
            operation: "close",
          });
        }
    } catch {
      console.error("QA session cleanup needs inspection for tenant " + r);
    }
    await ok(
      service
        .from("restaurants")
        .update({ is_published: false, is_accepting_orders: false })
        .in("id", [r, other]),
      "QA unpublish",
    );
    await ok(
      service
        .from("dining_tables")
        .update({ is_active: false })
        .eq("restaurant_id", r),
      "QA deactivate",
    );
  }
  await Promise.allSettled(clients.map((c) => c.removeAllChannels()));
}
console.log(
  `Pilot API/database/actual WebSocket verification: ${checks.length} checks passed. No browser or physical-device claim.`,
);
