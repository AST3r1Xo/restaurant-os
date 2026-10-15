import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
nextEnv.loadEnvConfig(process.cwd(), true);
const clients = [];
function check(value, message) {
  if (!value) throw new Error(message);
  console.log(`PASS ${message}`);
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
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(15000) }),
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
      throw new Error("Current visit unavailable");
    name = "review_visit_order";
    args = { ...args, visit_key: context.data[0].visit_key };
  }

  const r = await c.rpc(name, args);
  if (r.error)
    throw new Error(`RPC ${name} failed (${r.error.code ?? "API_ERROR"})`);
  return r.data;
}
async function subscribe(c, filter, events) {
  const channel = c
    .channel(`kitchen-test:${randomUUID()}`, {
      config: { postgres_changes_options: { wait: true, timeout: 15000 } },
    })
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "orders",
        ...(filter ? { filter } : {}),
      },
      (e) => events.push(e),
    );
  await new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error("Realtime subscription timed out")),
      25000,
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
async function until(predicate, message) {
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}
async function guest() {
  const c = client();
  const result = await c.auth.signInAnonymously();
  check(
    !result.error && result.data.user?.is_anonymous,
    "Anonymous test identity established",
  );
  return c;
}
async function order(c, slug, token, items) {
  const review = await rpc(c, "review_guest_order", {
    restaurant_slug: slug,
    table_token: token,
    items,
  });
  return rpc(c, "create_guest_order", {
    restaurant_slug: slug,
    table_token: token,
    items,
    idempotency_key: randomUUID(),
    review_id: review.reviewId,
  });
}
async function main() {
  for (const key of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "STAFF_TEST_EMAIL",
    "STAFF_TEST_PASSWORD",
    "ORDER_TEST_TABLE_TOKEN",
    "ORDER_ISOLATION_TABLE_TOKEN",
  ])
    if (!process.env[key])
      throw new Error(
        `Missing ${key}; store credentials only in ignored local configuration.`,
      );
  const staff = client(),
    secondDevice = client();
  for (const c of [staff, secondDevice]) {
    const auth = await c.auth.signInWithPassword({
      email: process.env.STAFF_TEST_EMAIL.trim(),
      password: process.env.STAFF_TEST_PASSWORD,
    });
    check(
      !auth.error && !auth.data.user?.is_anonymous,
      "Permanent staff sign-in verified",
    );
  }
  const { data: restaurant, error } = await staff
    .from("restaurants")
    .select("id,slug")
    .eq("slug", "mesa")
    .single();
  check(!error && !!restaurant, "Staff restaurant resolved");
  const r = restaurant.id;
  const initial = await rpc(staff, "get_kitchen_snapshot", {
    target_restaurant: r,
  });
  check(
    initial.restaurantId === r,
    "Authorized initial kitchen snapshot fetched",
  );
  const owner = await guest(),
    outsider = await guest(),
    foreignGuest = await guest();
  const staffEvents = [],
    secondEvents = [],
    guestEvents = [],
    outsiderEvents = [];
  await subscribe(staff, null, staffEvents); // Intentionally broad: RLS must isolate.
  await subscribe(secondDevice, `restaurant_id=eq.${r}`, secondEvents);
  await subscribe(owner, `restaurant_id=eq.${r}`, guestEvents);
  await subscribe(outsider, `restaurant_id=eq.${r}`, outsiderEvents);
  console.log(
    "All real WebSocket subscriptions are ready before order creation.",
  );
  const { data: products } = await owner
    .from("products")
    .select("id,name")
    .eq("restaurant_id", r)
    .eq("name", "Smoked salmon eggs");
  const p = products?.[0];
  check(!!p, "Seed dish loaded");
  const { data: groups } = await owner
    .from("product_modifier_groups")
    .select("id,name")
    .eq("restaurant_id", r)
    .eq("product_id", p.id);
  const bread = groups.find((g) => g.name === "Your bread");
  const { data: options } = await owner
    .from("modifier_options")
    .select("id,name")
    .eq("restaurant_id", r)
    .eq("group_id", bread.id);
  const brioche = options.find((o) => o.name === "Toasted brioche");
  const items = [{ productId: p.id, optionIds: [brioche.id], quantity: 1 }];
  const created = await order(
    owner,
    "mesa",
    process.env.ORDER_TEST_TABLE_TOKEN,
    items,
  );
  await until(
    () =>
      staffEvents.some(
        (e) => e.eventType === "INSERT" && e.new.id === created.id,
      ) &&
      secondEvents.some((e) => e.new.id === created.id) &&
      guestEvents.some((e) => e.new.id === created.id),
    "New order event was not delivered",
  );
  check(true, "New order delivered to two staff devices and its owning guest");
  const pendingHistory = await rpc(owner, "get_guest_order_history", {
    restaurant_slug: "mesa",
  });
  check(
    pendingHistory.orders.length === 1 &&
      pendingHistory.orders[0].id === created.id &&
      pendingHistory.totals.pendingMinor === created.totalMinor &&
      pendingHistory.totals.confirmedMinor === 0,
    "Private history records the trusted pending amount",
  );
  const transition = {
    target_restaurant: r,
    target_order: created.id,
    expected_status: "pending",
    next_status: "accepted",
  };
  const competing = await Promise.all([
    staff.rpc("transition_order", transition),
    secondDevice.rpc("transition_order", transition),
  ]);
  check(
    competing.filter((x) => !x.error).length === 1 &&
      competing.filter((x) => x.error?.message === "STATUS_CONFLICT").length ===
        1,
    "Concurrent staff acceptance has exactly one winner",
  );
  for (const [expected, next] of [
    ["accepted", "preparing"],
    ["preparing", "ready"],
    ["ready", "served"],
  ]) {
    await until(
      () =>
        guestEvents.some(
          (e) => e.new.id === created.id && e.new.status === expected,
        ),
      `Guest missed ${expected}`,
    );
    await rpc(staff, "transition_order", {
      target_restaurant: r,
      target_order: created.id,
      expected_status: expected,
      next_status: next,
    });
    await until(
      () =>
        guestEvents.some(
          (e) => e.new.id === created.id && e.new.status === next,
        ) &&
        secondEvents.some(
          (e) => e.new.id === created.id && e.new.status === next,
        ),
      `Realtime missed ${next}`,
    );
    check(true, `${expected} → ${next} delivered by Realtime`);
    const history = await rpc(owner, "get_guest_order_history", {
      restaurant_slug: "mesa",
    });
    check(
      history.orders[0].status === next &&
        history.totals.confirmedMinor === created.totalMinor &&
        history.totals.pendingMinor === 0,
      `Guest ledger retains the accepted amount in ${next}`,
    );
  }
  const cancelled = await order(
    owner,
    "mesa",
    process.env.ORDER_TEST_TABLE_TOKEN,
    items,
  );
  await rpc(staff, "transition_order", {
    target_restaurant: r,
    target_order: cancelled.id,
    expected_status: "pending",
    next_status: "cancelled",
    reason: "Development cancellation verification",
  });
  const progress = await rpc(owner, "get_guest_order_progress", {
    restaurant_slug: "mesa",
    order_id: cancelled.id,
  });
  check(
    progress.status === "cancelled" && !!progress.cancelReason,
    "Guest receives persisted decline reason",
  );
  const history = await rpc(owner, "get_guest_order_history", {
    restaurant_slug: "mesa",
  });
  check(
    history.orders.length === 2 &&
      history.totals.confirmedMinor === created.totalMinor &&
      history.totals.orderValueMinor === created.totalMinor &&
      history.totals.cancelledMinor === cancelled.totalMinor &&
      history.orders.some((o) => o.id === cancelled.id && o.cancelReason),
    "Multiple-order bill excludes cancellation and retains confirmed snapshots",
  );
  const outsiderHistory = await rpc(outsider, "get_guest_order_history", {
    restaurant_slug: "mesa",
  });
  check(
    outsiderHistory.orders.length === 0 &&
      outsiderHistory.totals.orderValueMinor === 0,
    "Another authenticated guest cannot see the restaurant ledger",
  );
  const foreignCursor = await outsider.rpc("get_guest_order_history", {
    restaurant_slug: "mesa",
    before_order_id: created.id,
  });
  check(
    foreignCursor.error?.message === "INVALID_REQUEST",
    "History cursors cannot reveal another guest's order",
  );
  const otherOrder = await order(
    foreignGuest,
    "kitchen-isolation-qa",
    process.env.ORDER_ISOLATION_TABLE_TOKEN,
    [
      {
        productId: "77777777-7777-4777-8777-777777777773",
        optionIds: [],
        quantity: 1,
      },
    ],
  );
  const denied = await staff.rpc("transition_order", {
    target_restaurant: otherOrder.restaurant.id,
    target_order: otherOrder.id,
    expected_status: "pending",
    next_status: "accepted",
  });
  check(
    denied.error?.message === "STAFF_FORBIDDEN",
    "Staff cannot mutate another restaurant",
  );
  const hidden = await staff
    .from("orders")
    .select("id")
    .eq("id", otherOrder.id);
  check(
    !hidden.error && hidden.data.length === 0,
    "Other restaurant order is hidden by RLS",
  );
  const foreignQueue = await staff.rpc("get_kitchen_snapshot", {
    target_restaurant: otherOrder.restaurant.id,
  });
  check(
    foreignQueue.error?.message === "STAFF_FORBIDDEN",
    "Other restaurant queue is denied",
  );
  const unknown = await rpc(outsider, "get_guest_order_progress", {
    restaurant_slug: "mesa",
    order_id: created.id,
  });
  check(unknown === null, "Shared QR guest cannot read another guest progress");
  const guestChange = await owner.rpc("transition_order", {
    target_restaurant: r,
    target_order: created.id,
    expected_status: "served",
    next_status: "pending",
  });
  check(
    guestChange.error?.message === "STAFF_REQUIRED",
    "Guest cannot perform staff actions",
  );
  const direct = await staff
    .from("orders")
    .update({ status: "pending" })
    .eq("id", created.id);
  check(direct.error?.code === "42501", "Direct status write is denied");
  await new Promise((resolve) => setTimeout(resolve, 1500));
  check(
    !staffEvents.some((e) => e.new.id === otherOrder.id),
    "Broad staff subscription receives no other-restaurant event",
  );
  check(
    !outsiderEvents.some((e) => [created.id, cancelled.id].includes(e.new.id)),
    "Another guest receives no private order event",
  );
  // A fresh snapshot recovers source-of-truth state after a WebSocket restart.
  secondDevice.realtime.disconnect();
  secondDevice.realtime.connect();
  const after = await rpc(secondDevice, "get_kitchen_snapshot", {
    target_restaurant: r,
  });
  check(
    after.orders.find((o) => o.id === created.id)?.status === "served" &&
      after.orders.find((o) => o.id === cancelled.id)?.status === "cancelled",
    "Reconnected device reconciles persisted completed orders",
  );
  console.log(
    JSON.stringify({
      servedOrder: { id: created.id, reference: created.reference },
      cancelledOrder: { id: cancelled.id, reference: cancelled.reference },
      isolationOrder: { id: otherOrder.id, reference: otherOrder.reference },
    }),
  );
  console.log(
    "Live verification passed. Three real test orders remain; no existing orders or catalog records were edited.",
  );
}
try {
  await main();
} catch (error) {
  console.error(
    `Kitchen live verification incomplete: ${error instanceof Error ? error.message : "Unknown error"}`,
  );
  process.exitCode = 1;
} finally {
  for (const c of clients) {
    await c.removeAllChannels();
    c.realtime.disconnect();
  }
}
