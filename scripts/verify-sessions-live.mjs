import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
nextEnv.loadEnvConfig(process.cwd(), true);
const clients = [],
  created = [];
let loseRequestResponse = false;
function check(value, message) {
  if (!value) throw new Error(message);
  console.log("PASS " + message);
}
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
        fetch: async (input, init) => {
          const response = await fetch(input, {
            ...init,
            signal: AbortSignal.timeout(15000),
          });
          if (
            loseRequestResponse &&
            String(input).endsWith("/rpc/request_session_bill") &&
            response.ok
          ) {
            loseRequestResponse = false;
            throw new Error("Simulated response loss after commit");
          }
          return response;
        },
      },
    },
  );
  clients.push(c);
  return c;
}
async function rpc(c, name, args) {
  if (name === "review_guest_order") {
    const context = await c.rpc("resolve_table_visit", {
      restaurant_slug: args.restaurant_slug,
      table_token: args.table_token,
    });
    if (context.error || !context.data?.[0])
      throw new Error("Current visit context unavailable");
    name = "review_visit_order";
    args = { ...args, visit_key: context.data[0].visit_key };
  }

  const { data, error } = await c.rpc(name, args);
  if (error)
    throw new Error(
      "RPC " + name + " failed (" + (error.code ?? "API_ERROR") + ")",
    );
  return data;
}
async function until(predicate, message) {
  const end = Date.now() + 14000;
  while (Date.now() < end) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error(message);
}
async function subscribe(c, restaurantId, events) {
  const ch = c.channel("session-test:" + randomUUID(), {
    config: { postgres_changes_options: { wait: true, timeout: 15000 } },
  });
  for (const table of ["orders", "table_sessions", "bill_requests"])
    ch.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table,
        filter: "restaurant_id=eq." + restaurantId,
      },
      (e) =>
        events.push({
          table: e.table,
          type: e.eventType,
          id: e.new.id,
          status: e.new.status,
          sessionId: e.new.session_id,
        }),
    );
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Realtime readiness timeout")),
      25000,
    );
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        resolve();
      } else if (status === "CHANNEL_ERROR") {
        clearTimeout(timer);
        reject(new Error("Realtime subscription failed"));
      }
    });
  });
}
async function main() {
  for (const name of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "STAFF_TEST_EMAIL",
    "STAFF_TEST_PASSWORD",
    "ORDER_SESSION_TEST_TABLE_TOKEN",
  ])
    if (!process.env[name])
      throw new Error("Missing ignored local configuration: " + name);
  const staff = client(),
    second = client(),
    a = client(),
    b = client(),
    outsider = client();
  for (const c of [staff, second]) {
    const auth = await c.auth.signInWithPassword({
      email: process.env.STAFF_TEST_EMAIL.trim(),
      password: process.env.STAFF_TEST_PASSWORD,
    });
    check(
      !auth.error && !auth.data.user?.is_anonymous,
      "Permanent staff identity verified",
    );
  }
  for (const c of [a, b, outsider]) {
    const auth = await c.auth.signInAnonymously();
    check(
      !auth.error && auth.data.user?.is_anonymous,
      "Independent anonymous guest established",
    );
  }
  const { data: restaurant } = await staff
    .from("restaurants")
    .select("id,slug")
    .eq("slug", "mesa")
    .single();
  check(!!restaurant, "Authorized restaurant found");
  const r = restaurant.id,
    token = process.env.ORDER_SESSION_TEST_TABLE_TOKEN;
  const initial = await rpc(staff, "get_table_workspace", {
    target_restaurant: r,
  });
  const { data: table } = await staff
    .from("dining_tables")
    .select("id,label")
    .eq("restaurant_id", r)
    .eq("qr_token", token)
    .single();
  check(!!table, "One intended development table resolved by authorized staff");
  check(
    !initial.tables.find((t) => t.id === table.id)?.session,
    "Test table has no active visit; existing visits are never closed by this script",
  );
  const eventsA = [],
    eventsB = [],
    eventsStaff = [],
    eventsSecond = [],
    eventsOutsider = [];
  await Promise.all(
    [
      [a, eventsA],
      [b, eventsB],
      [staff, eventsStaff],
      [second, eventsSecond],
      [outsider, eventsOutsider],
    ].map(([c, e]) => subscribe(c, r, e)),
  );
  const { data: product } = await a
    .from("products")
    .select("id")
    .eq("restaurant_id", r)
    .eq("name", "Smoked salmon eggs")
    .single();
  const { data: bread } = await a
    .from("modifier_options")
    .select("id")
    .eq("restaurant_id", r)
    .eq("name", "Toasted brioche")
    .single();
  check(!!product && !!bread, "Trusted demo dish and required selection found");
  async function intent(c, qty) {
    const items = [
        { productId: product.id, optionIds: [bread.id], quantity: qty },
      ],
      key = randomUUID();
    const review = await rpc(c, "review_guest_order", {
      restaurant_slug: "mesa",
      table_token: token,
      items,
    });
    return {
      restaurant_slug: "mesa",
      table_token: token,
      items,
      idempotency_key: key,
      review_id: review.reviewId,
    };
  }
  const [ia, ib] = await Promise.all([intent(a, 1), intent(b, 2)]);
  const [oa, ob] = await Promise.all([
    rpc(a, "create_guest_order", ia),
    rpc(b, "create_guest_order", ib),
  ]);
  created.push(oa.id, ob.id);
  const [ba, bb] = await Promise.all([
    rpc(a, "get_guest_table_bill", {
      restaurant_slug: "mesa",
      table_token: token,
    }),
    rpc(b, "get_guest_table_bill", {
      restaurant_slug: "mesa",
      table_token: token,
    }),
  ]);
  const sessionId = ba.id;
  check(
    ba.id === bb.id &&
      ba.access === "waiting" &&
      bb.access === "waiting" &&
      !ba.totals,
    "Concurrent orders share one visit, without granting pending guests totals",
  );
  const association = await staff
    .from("orders")
    .select("id,session_id,table_id,restaurant_id")
    .in("id", created);
  check(
    !association.error &&
      association.data.every(
        (o) =>
          o.session_id === sessionId &&
          o.table_id === table.id &&
          o.restaurant_id === r,
      ),
    "Real order/session/table/restaurant associations verified",
  );
  await until(
    () =>
      eventsStaff.some((e) => e.table === "orders" && e.id === oa.id) &&
      eventsSecond.some((e) => e.id === ob.id),
    "Staff missed new orders",
  );
  const change = async (o, from, to, reason) =>
    rpc(staff, "transition_order", {
      target_restaurant: r,
      target_order: o.id,
      expected_status: from,
      next_status: to,
      ...(reason ? { reason } : {}),
    });
  await change(oa, "pending", "accepted");
  await until(
    () =>
      eventsA.some((e) => e.table === "table_sessions" && e.id === sessionId),
    "Authorized participant missed session update",
  );
  const accepted = await rpc(a, "get_guest_table_bill", {
    restaurant_slug: "mesa",
    table_token: token,
  });
  check(
    accepted.access === "active" &&
      accepted.totals.confirmedMinor === oa.totalMinor &&
      accepted.totals.pendingMinor === ob.totalMinor,
    "Staff acceptance grants current-session bill access",
  );
  check(
    accepted.lines.length === 2 &&
      accepted.lines.some(
        (line) => line.status === "pending" && line.quantity === 2,
      ) &&
      !JSON.stringify(accepted.lines).includes(ob.id),
    "Shared bill contains stored dishes and quantities, without private receipt identifiers",
  );
  check(
    !(
      await rpc(b, "get_guest_table_bill", {
        restaurant_slug: "mesa",
        table_token: token,
      })
    ).totals,
    "Unaccepted guest still has no shared totals",
  );
  await change(ob, "pending", "accepted");
  const sharedDishes = await rpc(b, "get_guest_table_bill", {
    restaurant_slug: "mesa",
    table_token: token,
  });
  check(
    sharedDishes.lines.length === 1 &&
      sharedDishes.lines[0].quantity === 3 &&
      sharedDishes.lines[0].lineTotalMinor === oa.totalMinor + ob.totalMinor,
    "Both approved guests share the combined itemized bill",
  );
  check(
    (await rpc(a, "get_guest_order", {
      restaurant_slug: "mesa",
      order_id: ob.id,
    })) === null,
    "Shared participants retain private order ownership",
  );
  check(
    (await rpc(outsider, "get_guest_table_bill", {
      restaurant_slug: "mesa",
      table_token: token,
    })) === null,
    "Same QR does not enroll an authenticated outsider",
  );
  const thirdIntent = await intent(b, 1),
    cancelled = await rpc(b, "create_guest_order", thirdIntent);
  created.push(cancelled.id);
  await change(
    cancelled,
    "pending",
    "cancelled",
    "Development session verification — unavailable item",
  );
  const expected = oa.totalMinor + ob.totalMinor,
    bill = await rpc(a, "get_guest_table_bill", {
      restaurant_slug: "mesa",
      table_token: token,
    });
  check(
    bill.totals.orderValueMinor === expected &&
      bill.totals.cancelledMinor === cancelled.totalMinor,
    "Shared bill excludes cancelled orders using stored amounts",
  );
  const [reqA, reqB] = await Promise.all([
    rpc(a, "request_session_bill", {
      restaurant_slug: "mesa",
      target_session: sessionId,
    }),
    rpc(b, "request_session_bill", {
      restaurant_slug: "mesa",
      target_session: sessionId,
    }),
  ]);
  check(
    reqA === reqB,
    "Concurrent bill requests deduplicate to one persistent record",
  );
  await until(
    () =>
      eventsStaff.some(
        (e) =>
          e.table === "bill_requests" && e.id === reqA && e.type === "INSERT",
      ) && eventsSecond.some((e) => e.id === reqA),
    "Staff missed bill request delivery",
  );
  loseRequestResponse = true;
  const uncertain = await a.rpc("request_session_bill", {
    restaurant_slug: "mesa",
    target_session: sessionId,
  });
  check(
    !!uncertain.error,
    "Uncertain network response simulated without trusting success",
  );
  check(
    (await rpc(a, "request_session_bill", {
      restaurant_slug: "mesa",
      target_session: sessionId,
    })) === reqA,
    "Safe bill-request retry recovers original record",
  );
  const op = {
    target_restaurant: r,
    target_table: table.id,
    target_session: sessionId,
    operation: "acknowledge",
  };
  await Promise.all([
    rpc(staff, "manage_table_session", op),
    rpc(second, "manage_table_session", op),
  ]);
  await until(
    () =>
      eventsA.some((e) => e.id === reqA && e.status === "acknowledged") &&
      eventsB.some((e) => e.id === reqA && e.status === "acknowledged"),
    "Guests missed acknowledgement events",
  );
  check(
    (
      await rpc(a, "get_guest_table_bill", {
        restaurant_slug: "mesa",
        table_token: token,
      })
    ).request.status === "acknowledged",
    "Customer acknowledgement persists in PostgreSQL",
  );
  const deniedClose = await staff.rpc("manage_table_session", {
    ...op,
    operation: "close",
  });
  check(
    deniedClose.error?.message === "ACTIVE_ORDERS",
    "Closing cannot abandon unfulfilled orders",
  );
  for (const o of [oa, ob])
    for (const [from, to] of [
      ["accepted", "preparing"],
      ["preparing", "ready"],
      ["ready", "served"],
    ])
      await change(o, from, to);
  const details = await rpc(staff, "get_staff_session_orders", {
    target_restaurant: r,
    target_session: sessionId,
  });
  check(
    details.orders.length === 3 &&
      details.orders.every((o) => o.items.length > 0),
    "Staff itemized session records include all guests and customizations",
  );
  await rpc(staff, "manage_table_session", { ...op, operation: "close" });
  const closed = await rpc(a, "get_guest_table_bill", {
    restaurant_slug: "mesa",
    table_token: token,
  });
  check(
    closed === null,
    "Closed session has no customer-visible bill or metadata",
  );
  const [nextA, nextB] = await Promise.all([
    rpc(staff, "manage_table_session", {
      target_restaurant: r,
      target_table: table.id,
      operation: "open",
    }),
    rpc(second, "manage_table_session", {
      target_restaurant: r,
      target_table: table.id,
      operation: "open",
    }),
  ]);
  check(
    nextA === nextB && nextA !== sessionId,
    "Concurrent next-visit creation produces one fresh session",
  );
  const ws = await rpc(staff, "get_table_workspace", { target_restaurant: r });
  const active = ws.tables.find((t) => t.id === table.id).session;
  check(
    active.id === nextA &&
      active.totals.orderValueMinor === 0 &&
      active.totals.orderCount === 0,
    "New visit has an empty recorded bill and no previous orders",
  );
  check(
    (
      await rpc(staff, "get_staff_session_orders", {
        target_restaurant: r,
        target_session: nextA,
      })
    ).orders.length === 0,
    "Historical orders do not enter the new session",
  );
  const closedRetry = await a.rpc("create_guest_order", ia);
  check(
    closedRetry.error?.message === "VISIT_ENDED",
    "Closed retries preserve uniqueness without historical access",
  );
  const oldGuest = await a.rpc("request_session_bill", {
    restaurant_slug: "mesa",
    target_session: nextA,
  });
  check(
    oldGuest.error?.message === "PARTICIPATION_REQUIRED",
    "Previous-visit membership cannot request the next visit bill",
  );
  const otherRestaurant = "77777777-7777-4777-8777-777777777770";
  const other = await staff.rpc("get_table_workspace", {
    target_restaurant: otherRestaurant,
  });
  check(
    other.error?.message === "STAFF_FORBIDDEN",
    "Other restaurant table workspace is denied",
  );
  const direct = await a
    .from("table_sessions")
    .update({ status: "closed" })
    .eq("id", nextA);
  check(direct.error?.code === "42501", "Direct lifecycle writes are denied");
  await new Promise((resolve) => setTimeout(resolve, 1000));
  check(
    !eventsOutsider.some(
      (e) => [sessionId, nextA].includes(e.id) || e.id === reqA,
    ),
    "Outsider receives no session or bill request events",
  );
  check(
    !eventsA.some(
      (e) => e.table === "orders" && [ob.id, cancelled.id].includes(e.id),
    ),
    "Shared participant receives no other guest private order events",
  );
  check(
    !eventsA.some((e) => e.table === "table_sessions" && e.id === nextA),
    "Previous participant receives no new-visit event",
  );
  check(
    ws.history.some(
      (s) => s.id === sessionId && s.totals.orderValueMinor === expected,
    ),
    "Historical visit and confirmed amounts remain available to staff",
  );
  console.log(
    JSON.stringify({
      pass: true,
      restaurantId: r,
      tableId: table.id,
      sessionId,
      nextSessionId: nextA,
      requestId: reqA,
      orderIds: created,
      expectedMinor: expected,
      staffBillEvents: eventsStaff.filter((e) => e.id === reqA),
      guestSessionEvents: eventsA.filter(
        (e) => e.table === "table_sessions" && e.id === sessionId,
      ).length,
      outsiderSessionEvents: eventsOutsider.length,
    }),
  );
}
try {
  await main();
} catch (error) {
  console.error("Session live verification failed: " + error.message);
  console.error(JSON.stringify({ createdOrderIds: created }));
  process.exitCode = 1;
} finally {
  for (const c of clients) {
    await c.removeAllChannels();
    c.realtime.disconnect();
  }
}
