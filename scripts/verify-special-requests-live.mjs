import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { fetchOrderReview, submitWithRecovery, fetchGuestOrder } from "../src/features/orders/repository.ts";

// Separately authorized Supabase administration provisions only an isolated QA
// restaurant/table/membership from --prepare. Every workflow call below uses an
// ordinary verified staff/guest session. Never read the media service credential.
if (process.env.CONFIRM_SPECIAL_REQUEST_QA !== "development")
  throw new Error("Set CONFIRM_SPECIAL_REQUEST_QA=development for isolated hosted verification.");
const project = "ahkleoidhzcsubsdlqbn";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(new URL(url).hostname, `${project}.supabase.co`, "Development project guard");
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const planPath = "/private/tmp/restaurant-os-special-requests-qa.json";
const reportPath = "/private/tmp/restaurant-os-special-requests-verification.json";
const clients = [];
let checks = 0;
function pass(label) { checks++; console.log(`PASS ${label}`); }
function client() {
  const transport = { loseNextCreationResponse: false, recoveredLostResponse: false };
  const c = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const response = await fetch(input, { ...init, signal: AbortSignal.timeout(20000) });
      const target = new URL(input instanceof Request ? input.url : input);
      if (transport.loseNextCreationResponse && target.pathname.endsWith("/rpc/create_guest_order") && response.ok) {
        transport.loseNextCreationResponse = false;
        transport.recoveredLostResponse = true;
        throw new TypeError("Deliberately lost the committed QA response");
      }
      return response;
    } },
  });
  clients.push(c);
  return { c, transport };
}
async function ok(promise, label) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label} failed (${error.code ?? "unavailable"}); credentials are withheld.`);
  return data;
}
const rpc = (c, name, args) => ok(c.rpc(name, args), name);
async function denied(c, name, args, expected) {
  const { error } = await c.rpc(name, args);
  assert.equal(error?.code, "P0001");
  assert.ok(expected.includes(error.message), "Expected a bounded application rejection");
}
const staff = client().c;
await ok(staff.auth.signInWithPassword({ email: process.env.STAFF_TEST_EMAIL?.trim(), password: process.env.STAFF_TEST_PASSWORD }), "Staff authentication");
const { user } = await ok(staff.auth.getUser(), "Verified staff identity");
assert.ok(user && !user.is_anonymous);

if (process.argv.includes("--prepare")) {
  const restaurantId = randomUUID();
  const plan = {
    project, restaurantId, ownerId: user.id,
    slug: `notes-qa-${restaurantId.slice(0, 8)}`, tableId: randomUUID(),
    categoryId: randomUUID(), productId: randomUUID(), groupId: randomUUID(),
    plainOptionId: randomUUID(), extraOptionId: randomUUID(),
  };
  await writeFile(planPath, JSON.stringify(plan, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ project, restaurantId, ownerId: user.id, slug: plan.slug, tableId: plan.tableId }));
} else {
  try {
    const plan = JSON.parse(await readFile(planPath, "utf8"));
    assert.equal(plan.project, project);
    assert.equal(plan.ownerId, user.id);
    assert.ok(plan.slug.startsWith("notes-qa-"));
    const r = plan.restaurantId;
    const ws = await rpc(staff, "menu_workspace", { target_restaurant: r });
    assert.equal(ws.restaurant.slug, plan.slug);
    assert.equal(ws.restaurant.name, "Special requests QA — not a real restaurant");
    const initial = await rpc(staff, "get_table_workspace", { target_restaurant: r });
    assert.equal(initial.tables.length, 1);
    assert.equal(initial.tables[0].session, null, "Never reuse an occupied table");
    const previous = await ok(staff.from("orders").select("id").eq("restaurant_id", r).limit(1), "Unused QA table guard");
    assert.equal(previous.length, 0, "Each verification requires a fresh isolated QA fixture");
    pass("ordinary verified owner has only the intended fresh QA workspace");
    await rpc(staff, "save_menu_category", { target_restaurant: r, category_id: plan.categoryId, expected_version: null, definition: { name: "Verification dishes", description: "Explicit QA fixtures", is_active: true } });
    await rpc(staff, "save_menu_product", {
      target_restaurant: r, product_id: plan.productId, expected_version: null,
      definition: {
        name: "QA special request dish", description: "Development verification, not actual restaurant food",
        category_id: plan.categoryId, price_minor: 1250, ingredients: ["QA ingredient"], allergens: [], dietary_tags: [],
        is_available: true, status: "published", keep_legacy_image: false, image_asset_id: null,
        model_asset_id: null, model_usdz_asset_id: null, model_poster_asset_id: null, model_verified: false, model_ar_enabled: false,
        review: { license: "", provenance: "", measurement_notes: "", confirmed: false },
        groups: [{ id: plan.groupId, name: "Your sauce", description: "", selection_type: "single", min_selections: 1, max_selections: 1, is_active: true,
          options: [{ id: plan.plainOptionId, name: "Plain", price_adjustment_minor: 0, is_available: true }, { id: plan.extraOptionId, name: "Garlic sauce", price_adjustment_minor: 150, is_available: true }] }],
      },
    });
    const codes = await rpc(staff, "get_table_qr_codes", { target_restaurant: r });
    const table = codes.find(t => t.id === plan.tableId);
    assert.ok(table?.qr_token);
    const a = client(), b = client();
    for (const guest of [a, b]) {
      await ok(guest.c.auth.signInAnonymously(), "Invisible QA guest session");
      const identity = await ok(guest.c.auth.getUser(), "Verified guest");
      assert.ok(identity.user.is_anonymous);
      guest.id = identity.user.id;
    }
    const staffEvents = [], aEvents = [], bEvents = [];
    async function subscribe(c, filter, events) {
      const channel = c.channel(`special-requests-qa:${randomUUID()}`, { config: { postgres_changes_options: { wait: true, timeout: 15000 } } })
        .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter }, event => events.push(event));
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Hosted Realtime subscription timed out")), 25000);
        channel.subscribe(status => {
          if (status === "SUBSCRIBED") { clearTimeout(timer); resolve(); }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(timer); reject(new Error("Hosted Realtime connection failed")); }
        });
      });
    }
    await Promise.all([subscribe(staff, `restaurant_id=eq.${r}`, staffEvents), subscribe(a.c, `customer_id=eq.${a.id}`, aEvents), subscribe(b.c, `customer_id=eq.${b.id}`, bEvents)]);
    pass("authorized staff and separate guests establish actual WebSocket subscriptions");
    const [visit] = await rpc(a.c, "resolve_table_visit", { restaurant_slug: plan.slug, table_token: table.qr_token });
    const request = { restaurantSlug: plan.slug, tableToken: table.qr_token, visitKey: visit.visit_key,
      items: [
        { productId: plan.productId, optionIds: [plan.extraOptionId], quantity: 2, notes: "Sem cebola\nMolho à parte" },
        { productId: plan.productId, optionIds: [plan.extraOptionId], quantity: 1, notes: "Com cebola" },
      ],
    };
    const quote = await fetchOrderReview(a.c, request);
    assert.equal(quote.totalMinor, 4200);
    assert.equal(quote.items.length, 2);
    assert.ok(quote.items.some(i => i.notes === request.items[0].notes));
    pass("hosted PostgreSQL reviews distinct special requests with trusted modifier prices");
    const submission = { ...request, reviewId: quote.reviewId, idempotencyKey: randomUUID() };
    a.transport.loseNextCreationResponse = true;
    const order = await submitWithRecovery(a.c, submission);
    assert.equal(order.totalMinor, 4200);
    assert.equal(order.items.length, 2);
    assert.ok(a.transport.recoveredLostResponse);
    assert.equal((await submitWithRecovery(a.c, submission)).id, order.id);
    pass("lost committed response recovers the original receipt and persistent retry creates no duplicate");
    await denied(a.c, "create_guest_order", {
      restaurant_slug: plan.slug, table_token: table.qr_token, review_id: quote.reviewId, idempotency_key: submission.idempotencyKey,
      items: [{ ...request.items[0], notes: "Changed request" }, request.items[1]],
    }, ["IDEMPOTENCY_CONFLICT"]);
    pass("reusing an idempotency key with changed instructions is rejected");
    const secondRequest = { ...request, items: [{ productId: plan.productId, optionIds: [plan.plainOptionId], quantity: 1, notes: "Second guest private request" }] };
    const secondReview = await fetchOrderReview(b.c, secondRequest);
    const secondOrder = await submitWithRecovery(b.c, { ...secondRequest, reviewId: secondReview.reviewId, idempotencyKey: randomUUID() });
    assert.equal(secondOrder.totalMinor, 1250);
    assert.equal(await fetchGuestOrder(b.c, plan.slug, { orderId: order.id }), null);
    assert.equal(await fetchGuestOrder(a.c, plan.slug, { orderId: secondOrder.id }), null);
    pass("guests at the same table cannot read one another's private requests or receipts");
    const kitchen = await rpc(staff, "get_kitchen_snapshot", { target_restaurant: r });
    const ticket = kitchen.orders.find(o => o.id === order.id);
    assert.ok(ticket.items.some(i => i.notes === request.items[0].notes && i.quantity === 2));
    assert.equal(ticket.items.length, 2);
    pass("real kitchen snapshot includes exact per-dish requests, quantities and modifier snapshots");
    const rows = await ok(staff.from("order_items").select("notes,quantity,unit_price_minor,selected_options").eq("restaurant_id", r).eq("order_id", order.id), "Stored item records");
    assert.equal(rows.length, 2);
    assert.ok(rows.every(i => i.unit_price_minor === 1400 && i.selected_options[0].priceAdjustmentMinor === 150));
    assert.ok(rows.some(i => i.notes === request.items[0].notes && i.quantity === 2));
    pass("authorized server queries verify real stored notes and unchanged trusted prices");
    for (const notes of ["x".repeat(301), "😀".repeat(151), null])
      await denied(a.c, "review_visit_order", { restaurant_slug: plan.slug, table_token: table.qr_token, visit_key: visit.visit_key, items: [{ ...request.items[0], notes }] }, ["INVALID_REQUEST"]);
    await denied(a.c, "review_visit_order", { restaurant_slug: plan.slug, table_token: table.qr_token, visit_key: visit.visit_key, items: [{ ...request.items[0], unitPriceMinor: 0 }] }, ["INVALID_REQUEST"]);
    await denied(a.c, "review_visit_order", { restaurant_slug: plan.slug, table_token: table.qr_token, visit_key: visit.visit_key, items: [{ ...request.items[0], productId: "44444444-4444-4444-8444-444444444441" }] }, ["PRODUCT_UNAVAILABLE"]);
    pass("hosted RPCs reject invalid note types/limits, price manipulation and cross-restaurant products");
    async function until(predicate) {
      const end = Date.now() + 15000;
      while (Date.now() < end) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
      throw new Error("Authoritative hosted event was not delivered within the verification window");
    }
    await until(() => staffEvents.some(e => e.eventType === "INSERT" && e.new.id === order.id) && staffEvents.some(e => e.eventType === "INSERT" && e.new.id === secondOrder.id));
    pass("actual new-order events reach the authorized kitchen over Realtime");
    for (const current of [order, secondOrder])
      await rpc(staff, "transition_order", { target_restaurant: r, target_order: current.id, expected_status: "pending", next_status: "ready" });
    await until(() => aEvents.some(e => e.new.id === order.id && e.new.status === "ready") && bEvents.some(e => e.new.id === secondOrder.id && e.new.status === "ready"));
    assert.ok(!aEvents.some(e => e.new.id === secondOrder.id));
    assert.ok(!bEvents.some(e => e.new.id === order.id));
    pass("actual status events reach only the correct guest; table sharing does not bypass ownership");
    const active = await rpc(a.c, "get_guest_table_bill", { restaurant_slug: plan.slug, table_token: table.qr_token });
    assert.equal(active.totals.confirmedMinor, 5450);
    assert.ok(!JSON.stringify(active).includes("cebola") && !JSON.stringify(active).includes("Second guest private request"));
    pass("current shared bill includes both orders' trusted amounts while redacting private notes");
    await rpc(a.c, "request_session_bill", { restaurant_slug: plan.slug, target_session: active.id });
    await rpc(staff, "manage_table_session", { target_restaurant: r, target_table: plan.tableId, target_session: active.id, operation: "acknowledge" });
    for (const current of [order, secondOrder])
      await rpc(staff, "transition_order", { target_restaurant: r, target_order: current.id, expected_status: "ready", next_status: "served" });
    await rpc(staff, "manage_table_session", { target_restaurant: r, target_table: plan.tableId, target_session: active.id, operation: "close" });
    assert.equal(await fetchGuestOrder(a.c, plan.slug, { orderId: order.id }), null);
    assert.equal(await fetchGuestOrder(b.c, plan.slug, { orderId: secondOrder.id }), null);
    const historical = await rpc(staff, "get_staff_session_orders", { target_restaurant: r, target_session: active.id });
    assert.equal(historical.orders.length, 2);
    assert.ok(historical.orders.find(o => o.id === order.id).items.some(i => i.notes === request.items[0].notes));
    const total = await ok(staff.from("orders").select("id").eq("restaurant_id", r), "Order count verification");
    assert.equal(total.length, 2);
    pass("closure revokes guest receipt access and preserves staff-only historical notes; exactly two orders exist");
    await writeFile(reportPath, JSON.stringify({ project, restaurantId: r, tableId: plan.tableId, sessionId: active.id, orderIds: [order.id, secondOrder.id], checks, verifiedAt: new Date().toISOString(), realtime: "actual WebSocket delivery", browser: "not verified", physicalDevice: "not available" }, null, 2), { mode: 0o600 });
    console.log(`PASS ${checks} hosted checks complete; Casa Mesa tables and orders were not used.`);
  } finally {
    await Promise.allSettled(clients.map(c => c.removeAllChannels()));
  }
}
