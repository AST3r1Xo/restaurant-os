import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { createClient } from "@supabase/supabase-js";
import { fetchOrderReview, submitWithRecovery, fetchGuestOrder } from "../src/features/orders/repository.ts";

// Bounded correctness/concurrency campaign, NEVER a cloud load/DoS generator.
// Provision only a fresh isolated fixture through separately authorized project
// administration. Workflow requests below use ordinary staff/guest credentials.
const project = "ahkleoidhzcsubsdlqbn";
assert.equal(process.env.CONFIRM_RESTAURANT_STRESS_QA, "development");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(new URL(url).hostname, `${project}.supabase.co`, "Development project guard");
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const planPath = "/private/tmp/restaurant-os-stress-qa.json";
const reportPath = "/private/tmp/restaurant-os-stress-verification.json";
const clients = [], checks = [], timings = [];
let rpcRequests = 0;
function pass(label) { checks.push(label); console.log(`PASS ${label}`); }
function client() {
  const transport = { loseNextCreationResponse: false, dropped: false };
  const c = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const target = new URL(input instanceof Request ? input.url : input), start = performance.now();
      const isRpc = target.pathname.includes("/rpc/");
      if (isRpc) rpcRequests++;
      const response = await fetch(input, { ...init, signal: AbortSignal.timeout(20000) });
      if (isRpc) timings.push({ operation: target.pathname.split("/").at(-1), ms: Math.round(performance.now() - start), status: response.status });
      if (transport.loseNextCreationResponse && target.pathname.endsWith("/rpc/create_guest_order") && response.ok) {
        transport.loseNextCreationResponse = false; transport.dropped = true;
        throw new TypeError("QA deliberately discarded a committed response");
      }
      return response;
    } },
  });
  clients.push(c); return { c, transport };
}
async function ok(promise, label) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label} failed (${error.code ?? "unavailable"}); credentials withheld`);
  return data;
}
const rpc = (c, name, args) => ok(c.rpc(name, args), name);
async function denied(c, name, args, codes) {
  const { error } = await c.rpc(name, args);
  assert.ok(error, `Expected denial of ${name}`);
  assert.ok(codes.includes(error.message) || codes.includes(error.code), `Unexpected rejection of ${name}: ${error.code}`);
}
async function until(predicate) {
  const end = Date.now() + 20000;
  while (Date.now() < end) { if (predicate()) return; await new Promise(r => setTimeout(r, 100)); }
  throw new Error("Expected hosted Realtime event did not arrive");
}
async function subscribe(c, table, filter, events) {
  const channel = c.channel(`restaurant-stress:${randomUUID()}`, { config: { postgres_changes_options: { wait: true, timeout: 15000 } } })
    .on("postgres_changes", { event: "*", schema: "public", table, filter }, e => events.push({ table, type: e.eventType, id: e.new.id, status: e.new.status }));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Hosted Realtime subscription timed out")), 25000);
    channel.subscribe(status => {
      if (status === "SUBSCRIBED") { clearTimeout(timer); resolve(); }
      if (["CHANNEL_ERROR", "TIMED_OUT"].includes(status)) { clearTimeout(timer); reject(new Error("Hosted Realtime connection failed")); }
    });
  });
  return channel;
}
async function staffClient() {
  const { c } = client();
  await ok(c.auth.signInWithPassword({ email: process.env.STAFF_TEST_EMAIL?.trim(), password: process.env.STAFF_TEST_PASSWORD }), "Staff authentication");
  const { user } = await ok(c.auth.getUser(), "Verified staff");
  assert.ok(user && !user.is_anonymous); return { c, id: user.id };
}
const staff = await staffClient();
if (process.argv.includes("--prepare")) {
  const restaurantId = randomUUID();
  const plan = { project, restaurantId, ownerId: staff.id, slug: `stress-qa-${restaurantId.slice(0, 8)}`,
    tableIds: Array.from({ length: 3 }, () => randomUUID()), foreignId: randomUUID(), foreignTableId: randomUUID(),
    categoryId: randomUUID(), productId: randomUUID(), groupId: randomUUID(), optionId: randomUUID() };
  await writeFile(planPath, JSON.stringify(plan, null, 2), { mode: 0o600 });
  const sql = `-- Isolated development fixture only. Apply through separately authorized\n-- administration after verifying project ${project}. Never use the media app key.\nbegin;\ninsert into public.restaurants(id,slug,name,is_published,is_accepting_orders) values\n('${plan.restaurantId}','${plan.slug}','Restaurant stress QA — not a real restaurant',true,true),\n('${plan.foreignId}','stress-foreign-${plan.foreignId.slice(0, 8)}','Foreign stress QA — not a real restaurant',true,true);\ninsert into public.restaurant_members(restaurant_id,user_id,role) values('${plan.restaurantId}','${plan.ownerId}','owner');\ninsert into public.dining_tables(id,restaurant_id,label) values\n${plan.tableIds.map((id, n) => `('${id}','${plan.restaurantId}','QA Table 0${n + 1}')`).join(",\n")},\n('${plan.foreignTableId}','${plan.foreignId}','Foreign QA Table');\ncommit;\n`;
  await writeFile("/private/tmp/restaurant-os-stress-provision.sql", sql, { mode: 0o600 });
  console.log(JSON.stringify(plan));
} else {
  const started = performance.now();
  try {
    const p = JSON.parse(await readFile(planPath, "utf8")), r = p.restaurantId;
    assert.equal(p.project, project); assert.equal(p.ownerId, staff.id); assert.ok(p.slug.startsWith("stress-qa-"));
    const ws = await rpc(staff.c, "menu_workspace", { target_restaurant: r });
    assert.equal(ws.restaurant.name, "Restaurant stress QA — not a real restaurant"); assert.equal(ws.restaurant.slug, p.slug);
    const workspace = () => rpc(staff.c, "get_table_workspace", { target_restaurant: r });
    const fresh = await workspace();
    assert.equal(fresh.tables.length, 3); assert.ok(fresh.tables.every(t => t.session === null));
    assert.equal((await ok(staff.c.from("orders").select("id").eq("restaurant_id", r).limit(1), "Fresh fixture guard")).length, 0);
    pass("fresh isolated QA restaurant, three unused tables and verified owner");
    await rpc(staff.c, "save_menu_category", { target_restaurant: r, category_id: p.categoryId, expected_version: null, definition: { name: "QA menu", description: "Development only", is_active: true } });
    const definition = { name: "QA customized dish", description: "Not actual restaurant food", category_id: p.categoryId, price_minor: 1299,
      ingredients: [], allergens: [], dietary_tags: [], is_available: true, status: "published", keep_legacy_image: false,
      image_asset_id: null, model_asset_id: null, model_usdz_asset_id: null, model_poster_asset_id: null, model_verified: false, model_ar_enabled: false,
      review: { license: "", provenance: "", measurement_notes: "", confirmed: false },
      groups: [{ id: p.groupId, name: "Choose sauce", description: "", selection_type: "single", min_selections: 1, max_selections: 1, is_active: true,
        options: [{ id: p.optionId, name: "QA sauce", price_adjustment_minor: 151, is_available: true }] }] };
    await rpc(staff.c, "save_menu_product", { target_restaurant: r, product_id: p.productId, expected_version: null, definition });
    async function saveProduct() {
      const catalog = await rpc(staff.c, "menu_workspace", { target_restaurant: r });
      const version = catalog.products.find(product => product.id === p.productId).updated_at;
      assert.ok(version);
      await rpc(staff.c, "save_menu_product", { target_restaurant: r, product_id: p.productId, expected_version: version, definition });
    }
    const codes = await rpc(staff.c, "get_table_qr_codes", { target_restaurant: r });
    const guests = [];
    // Sequential Auth creation avoids overwhelming shared development Auth limits.
    for (let n = 0; n < 6; n++) {
      const guest = client(); await ok(guest.c.auth.signInAnonymously(), "Anonymous guest");
      const { user } = await ok(guest.c.auth.getUser(), "Verified guest"); assert.ok(user.is_anonymous);
      const table = codes.find(t => t.id === p.tableIds[Math.floor(n / 2)]);
      const [visit] = await rpc(guest.c, "resolve_table_visit", { restaurant_slug: p.slug, table_token: table.qr_token });
      guests.push({ ...guest, id: user.id, table, visitKey: visit.visit_key });
    }
    pass("six independent verified anonymous guests at three tables");
    const staff2 = await staffClient(), events1 = [], events2 = [], guestEvents = [], billEvents = [];
    await Promise.all([
      subscribe(staff.c, "orders", `restaurant_id=eq.${r}`, events1),
      subscribe(staff2.c, "orders", `restaurant_id=eq.${r}`, events2),
      subscribe(guests[0].c, "orders", `customer_id=eq.${guests[0].id}`, guestEvents),
      subscribe(staff.c, "bill_requests", `restaurant_id=eq.${r}`, billEvents),
    ]);
    pass("two staff devices and guest establish actual scoped WebSocket subscriptions");
    const request = (g, qty = 1, notes = "Private QA request") => ({ restaurantSlug: p.slug, tableToken: g.table.qr_token, visitKey: g.visitKey,
      items: [{ productId: p.productId, optionIds: [p.optionId], quantity: qty, notes }] });
    async function intent(g, qty, notes) {
      const req = request(g, qty, notes), review = await fetchOrderReview(g.c, req);
      assert.equal(review.totalMinor, (definition.price_minor + 151) * qty);
      return { ...req, reviewId: review.reviewId, idempotencyKey: randomUUID() };
    }
    const args = s => ({ restaurant_slug: s.restaurantSlug, table_token: s.tableToken, items: s.items, idempotency_key: s.idempotencyKey, review_id: s.reviewId });
    const orders = [], submissions = [];
    const first = await intent(guests[0], 2, "No onions"), second = await intent(guests[1], 1, "Sauce aside");
    const duplicateResults = await Promise.all([first, first, first, second, second, second].map((s, n) => submitWithRecovery(guests[n < 3 ? 0 : 1].c, s)));
    assert.equal(new Set(duplicateResults.map(o => o.id)).size, 2);
    orders.push(duplicateResults[0], duplicateResults[3]); submissions.push(first, second);
    pass("six simultaneous submissions produce exactly two orders, one per guest/key");
    const conflictA = await intent(guests[2], 1, "Conflict A"), conflictB = await intent(guests[2], 2, "Conflict B");
    conflictB.idempotencyKey = conflictA.idempotencyKey;
    const conflict = await Promise.all([guests[2].c.rpc("create_guest_order", args(conflictA)), guests[2].c.rpc("create_guest_order", args(conflictB))]);
    assert.equal(conflict.filter(x => !x.error).length, 1);
    assert.equal(conflict.find(x => x.error)?.error.message, "IDEMPOTENCY_CONFLICT");
    const winner = conflict.findIndex(x => !x.error);
    orders.push(conflict[winner].data); submissions.push(winner ? conflictB : conflictA);
    pass("simultaneous conflicting contents under one key commit one winner and reject the other");
    for (let n = 3; n < 6; n++) {
      const s = await intent(guests[n], 1, `Private request ${n}`); submissions.push(s);
      if (n === 4) guests[n].transport.loseNextCreationResponse = true;
      orders.push(await submitWithRecovery(guests[n].c, s));
    }
    assert.ok(guests[4].transport.dropped);
    pass("discarded committed response recovers its receipt without creating a replacement order");
    const populated = await workspace();
    assert.ok(populated.tables.every(t => t.session?.totals.orderCount === 2));
    const sessions = p.tableIds.map(id => populated.tables.find(t => t.id === id).session);
    assert.equal(new Set(sessions.map(s => s.id)).size, 3);
    pass("simultaneous first orders share exactly one active session per table");
    await until(() => orders.every(o => events1.some(e => e.type === "INSERT" && e.id === o.id) && events2.some(e => e.type === "INSERT" && e.id === o.id)));
    pass("all six real order INSERTs reach both staff devices without refreshing");
    for (let n = 0; n < guests.length; n++) {
      const own = await fetchGuestOrder(guests[n].c, p.slug, { orderId: orders[n].id }); assert.equal(own.id, orders[n].id);
      assert.equal(await fetchGuestOrder(guests[n].c, p.slug, { orderId: orders[n ^ 1].id }), null);
      const waiting = await rpc(guests[n].c, "get_guest_table_bill", { restaurant_slug: p.slug, table_token: guests[n].table.qr_token });
      assert.equal(waiting.access, "waiting"); assert.equal(waiting.totals, undefined);
    }
    pass("same-table diners cannot read each other's receipts or shared totals before staff confirmation");
    await denied(staff.c, "get_kitchen_snapshot", { target_restaurant: p.foreignId }, ["STAFF_FORBIDDEN"]);
    await denied(staff.c, "menu_workspace", { target_restaurant: p.foreignId }, ["STAFF_FORBIDDEN", "MANAGER_REQUIRED"]);
    await denied(guests[0].c, "get_kitchen_snapshot", { target_restaurant: r }, ["STAFF_REQUIRED"]);
    await denied(guests[0].c, "transition_order", { target_restaurant: r, target_order: orders[0].id, expected_status: "pending", next_status: "ready" }, ["STAFF_REQUIRED"]);
    pass("guest staff impersonation and owner access to an unrelated restaurant are denied");
    const transition = (c, o, from, to, reason) => c.rpc("transition_order", { target_restaurant: r, target_order: o.id, expected_status: from, next_status: to, ...(reason ? { reason } : {}) });
    const race = await Promise.all([transition(staff.c, orders[0], "pending", "ready"), transition(staff2.c, orders[0], "pending", "cancelled", "Competing QA decline")]);
    assert.equal(race.filter(x => !x.error).length, 1); assert.equal(race.find(x => x.error)?.error.message, "STATUS_CONFLICT");
    const firstStatus = race[0].error ? "cancelled" : "ready";
    pass("two employees racing ready versus decline produce exactly one authorized transition");
    for (let n = 1; n < 6; n++) await ok(transition(staff.c, orders[n], "pending", n === 5 ? "cancelled" : "ready", n === 5 ? "QA cancellation" : undefined), "Prepare/decline");
    await until(() => guestEvents.some(e => e.id === orders[0].id && e.status === firstStatus));
    assert.ok(guestEvents.every(e => e.id === orders[0].id));
    pass("actual guest status events remain private to their own orders");
    for (let t = 0; t < 3; t++) {
      const g = guests[t * 2 + (t === 0 && firstStatus === "cancelled" ? 1 : 0)];
      const bill = await rpc(g.c, "get_guest_table_bill", { restaurant_slug: p.slug, table_token: g.table.qr_token });
      const expected = orders.slice(t * 2, t * 2 + 2).reduce((s, o, i) => s + ((t === 2 && i === 1) || (t === 0 && i === 0 && firstStatus === "cancelled") ? 0 : o.totalMinor), 0);
      assert.equal(bill.totals.orderValueMinor, expected); assert.equal(bill.totals.pendingMinor, 0);
      assert.equal(bill.lines.reduce((sum, line) => sum + (line.status === "cancelled" ? 0 : line.lineTotalMinor), 0), expected);
      const json = JSON.stringify(bill);
      for (const o of orders) { assert.ok(!json.includes(o.id)); assert.ok(!json.includes(o.reference)); }
      for (const g2 of guests) assert.ok(!json.includes(g2.id));
      assert.ok(!json.includes("Private request") && !json.includes("Sauce aside") && !json.includes("No onions"));
    }
    pass("three shared bills use trusted itemized amounts, exclude cancellations and redact identities/notes");
    const requester = guests[1], session = sessions[0];
    const billArgs = { restaurant_slug: p.slug, target_session: session.id };
    await Promise.all(Array.from({ length: 3 }, () => rpc(requester.c, "request_session_bill", billArgs)));
    const requests = await ok(staff.c.from("bill_requests").select("id,status").eq("restaurant_id", r).eq("session_id", session.id), "Request deduplication");
    assert.equal(requests.length, 1); await until(() => billEvents.some(e => e.id === requests[0].id && e.status === "requested"));
    pass("three simultaneous bill requests create one durable request and notify staff over Realtime");
    const billGuestEvents = [];
    await subscribe(requester.c, "bill_requests", `session_id=eq.${session.id}`, billGuestEvents);
    const ackArgs = { target_restaurant: r, target_table: p.tableIds[0], target_session: session.id, operation: "acknowledge" };
    await Promise.all([rpc(staff.c, "manage_table_session", ackArgs), rpc(staff2.c, "manage_table_session", ackArgs)]);
    await until(() => billGuestEvents.some(e => e.status === "acknowledged"));
    pass("concurrent acknowledgements are safe and the customer receives the real acknowledgement event");
    // Disconnect only the owned QA guest channel; fetch restores authoritative state.
    await guests[0].c.removeAllChannels();
    if (firstStatus === "ready") await ok(transition(staff.c, orders[0], "ready", "served"), "Serve while guest disconnected");
    const reconnectedEvents = [];
    await subscribe(guests[0].c, "orders", `customer_id=eq.${guests[0].id}`, reconnectedEvents);
    assert.equal((await fetchGuestOrder(guests[0].c, p.slug, { orderId: orders[0].id })).status, firstStatus === "ready" ? "served" : "cancelled");
    pass("reconnected guest reconciles a status change missed while disconnected");
    // Price and availability change between review and submission, before commit.
    const stale = await intent(guests[1], 1, "Price update check");
    definition.price_minor = 1399;
    await saveProduct();
    await denied(guests[1].c, "create_guest_order", args(stale), ["ORDER_CHANGED"]);
    const availableQuote = await intent(guests[1], 1, "Availability check");
    definition.is_available = false;
    await saveProduct();
    await denied(guests[1].c, "create_guest_order", args(availableQuote), ["PRODUCT_UNAVAILABLE"]);
    definition.is_available = true;
    await saveProduct();
    assert.equal((await fetchGuestOrder(guests[1].c, p.slug, { orderId: orders[1].id })).totalMinor, orders[1].totalMinor);
    pass("changed price and unavailable dish block stale submission; committed historical amounts remain unchanged");
    const beforeClosure = await intent(guests[3], 1, "Restaurant closure check");
    await rpc(staff.c, "set_restaurant_open", { target_restaurant: r, expected_open: true, next_open: false });
    await denied(guests[3].c, "create_guest_order", args(beforeClosure), ["RESTAURANT_UNAVAILABLE"]);
    assert.ok(await fetchGuestOrder(guests[3].c, p.slug, { orderId: orders[3].id }));
    for (let n = 1; n < 5; n++) await ok(transition(staff.c, orders[n], "ready", "served"), "Complete existing service while closed");
    await rpc(staff.c, "set_restaurant_open", { target_restaurant: r, expected_open: false, next_open: true });
    pass("closing rejects new orders but preserves guest receipts and staff completion; reopening succeeds");
    for (let n = 0; n < 3; n++)
      await rpc(staff.c, "manage_table_session", { target_restaurant: r, target_table: p.tableIds[n], target_session: sessions[n].id, operation: "close" });
    for (let n = 0; n < 6; n++) {
      assert.equal(await fetchGuestOrder(guests[n].c, p.slug, { orderId: orders[n].id }), null);
      assert.equal(await fetchGuestOrder(guests[n].c, p.slug, { idempotencyKey: submissions[n].idempotencyKey }), null);
      assert.equal((await ok(guests[n].c.from("orders").select("id").eq("restaurant_id", r), "Revoked RLS reads")).length, 0);
      await denied(guests[n].c, "create_guest_order", args(submissions[n]), ["VISIT_ENDED"]);
      assert.equal((await rpc(guests[n].c, "get_guest_visit_order_history", { restaurant_slug: p.slug, table_token: guests[n].table.qr_token })).orders.length, 0);
    }
    pass("closure revokes all six guests' receipts, idempotent recovery, history and direct RLS reads");
    const oldVisit = guests[0].visitKey;
    const [nextVisit] = await rpc(guests[0].c, "resolve_table_visit", { restaurant_slug: p.slug, table_token: guests[0].table.qr_token });
    assert.notEqual(nextVisit.visit_key, oldVisit);
    await denied(guests[0].c, "review_visit_order", { restaurant_slug: p.slug, table_token: guests[0].table.qr_token, visit_key: oldVisit, items: request(guests[0]).items }, ["SESSION_CHANGED"]);
    const openArgs = { target_restaurant: r, target_table: p.tableIds[0], operation: "open" };
    const nextSessions = await Promise.all([rpc(staff.c, "manage_table_session", openArgs), rpc(staff2.c, "manage_table_session", openArgs)]);
    assert.equal(nextSessions[0], nextSessions[1]); assert.notEqual(nextSessions[0], sessions[0].id);
    const nextWs = await workspace(), nextSession = nextWs.tables.find(t => t.id === p.tableIds[0]).session;
    assert.equal(nextSession.totals.orderValueMinor, 0); assert.equal(nextSession.totals.orderCount, 0);
    assert.equal(await rpc(guests[0].c, "get_guest_table_bill", { restaurant_slug: p.slug, table_token: guests[0].table.qr_token }), null);
    pass("concurrent new-visit creation returns one empty session with no inherited guest membership");
    await rpc(staff.c, "manage_table_session", { ...openArgs, target_session: nextSession.id, operation: "close" });
    for (let n = 0; n < 3; n++) assert.equal((await rpc(staff.c, "get_staff_session_orders", { target_restaurant: r, target_session: sessions[n].id })).orders.length, 2);
    const retained = await ok(staff.c.from("orders").select("id").eq("restaurant_id", r), "Final retained order count");
    assert.equal(retained.length, 6);
    pass("staff retain all six orders and three itemized historical visits; no partial or duplicate orders exist");
    const report = { project, restaurantId: r, slug: p.slug, checks, rpcRequests, actualOrders: retained.length,
      elapsedMs: Math.round(performance.now() - started), timings, verifiedAt: new Date().toISOString(),
      realtime: "actual Supabase WebSocket delivery", browser: "not verified by this API campaign", physicalDevice: "not available" };
    await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(`PASS ${checks.length} hosted scenarios; ${rpcRequests} RPC requests; six retained QA orders. No Casa Mesa mutations.`);
  } finally { await Promise.allSettled(clients.map(c => c.removeAllChannels())); }
}
