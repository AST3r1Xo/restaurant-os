import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  decodeGuestHistory,
  fetchGuestHistory,
  mergeHistoryPages,
} from "../src/features/orders/history/repository.ts";
const r = "11111111-1111-4111-8111-111111111111",
  id = "99999999-9999-4999-8999-999999999999";
const order = {
  id,
  reference: "ABC123",
  restaurant: { id: r, slug: "mesa", name: "Casa Mesa" },
  table: { label: "Table 04" },
  currency: "EUR",
  status: "pending",
  createdAt: "2026-10-14T12:00:00Z",
  updatedAt: "2026-10-14T12:00:00Z",
  cancelReason: null,
  subtotalMinor: 1400,
  totalMinor: 1400,
  items: [
    {
      productId: "44444444-4444-4444-8444-444444444441",
      productName: "Eggs",
      quantity: 1,
      basePriceMinor: 1400,
      unitPriceMinor: 1400,
      lineTotalMinor: 1400,
      options: [],
    },
  ],
};
const data = {
  scope: "visit",
  visit: { id, tableLabel: "Table 04", openedAt: order.createdAt },
  restaurant: order.restaurant,
  currency: "EUR",
  timezone: "Europe/Lisbon",
  fetchedAt: "2026-10-14T12:01:00Z",
  totals: {
    orderValueMinor: 4700,
    confirmedMinor: 3300,
    pendingMinor: 1400,
    cancelledMinor: 500,
    confirmedCount: 1,
    pendingCount: 1,
    cancelledCount: 1,
    orderCount: 3,
  },
  orders: [order],
  nextCursor: null,
};
test("decoder preserves database totals beyond the currently visible page", () => {
  const value = decodeGuestHistory(data, "mesa");
  assert.equal(value.totals.confirmedMinor, 3300);
  assert.equal(value.orders.length, 1);
});
test("decoder rejects tenant, currency, snapshot, count, duplicate and precision corruption", () => {
  const mutations = [
    (v) =>
      (v.orders[0].restaurant = {
        ...v.orders[0].restaurant,
        id: "77777777-7777-4777-8777-777777777777",
      }),
    (v) => (v.currency = "USD"),
    (v) => (v.orders[0].totalMinor = 1),
    (v) => (v.totals.pendingMinor = 1),
    (v) => (v.totals.confirmedMinor = Number.MAX_SAFE_INTEGER + 1),
    (v) => (v.totals.orderCount = 1),
    (v) => v.orders.push(v.orders[0]),
    (v) => (v.timezone = "not/timezone"),
    (v) => (v.nextCursor = id),
  ];
  for (const mutate of mutations) {
    const v = structuredClone(data);
    mutate(v);
    assert.throws(() => decodeGuestHistory(v, "mesa"));
  }
});
test("queries submit only a restaurant slug and optional owned cursor, never QR, guest IDs or cart prices", async () => {
  let sent;
  const client = createClient("https://project.supabase.co", "public-key", {
    auth: { persistSession: false },
    global: {
      fetch: async (_input, init) => {
        sent = JSON.parse(init.body);
        return new Response(JSON.stringify(data), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  });
  await fetchGuestHistory(client, "mesa", id);
  assert.deepEqual(sent, { restaurant_slug: "mesa", before_order_id: id });
  await assert.rejects(() => fetchGuestHistory(client, "../mesa"));
  await assert.rejects(() => fetchGuestHistory(client, "mesa", "bad"));
});
test("current-visit queries use a separate owned ledger and QR only as a table selector", async () => {
  let sent;
  const token = "22222222-2222-4222-8222-222222222222";
  const current = {
    ...data,
    scope: "visit",
    visit: { id, tableLabel: "Table 04", openedAt: order.createdAt },
  };
  const client = createClient("https://project.supabase.co", "public-key", {
    auth: { persistSession: false },
    global: {
      fetch: async (input, init) => {
        sent = { url: String(input), body: JSON.parse(init.body) };
        return new Response(JSON.stringify(current), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  });
  const result = await fetchGuestHistory(client, "mesa", null, {
    scope: "visit",
    tableToken: token,
  });
  assert.equal(result.scope, "visit");
  assert.ok(sent.url.endsWith("/rpc/get_guest_visit_order_history"));
  assert.deepEqual(sent.body, { restaurant_slug: "mesa", table_token: token });
  await assert.rejects(() =>
    fetchGuestHistory(client, "mesa", null, {
      scope: "visit",
      tableToken: "bad",
    }),
  );
  assert.throws(() => decodeGuestHistory({ ...current, visit: null }, "mesa"));
  assert.throws(() => decodeGuestHistory({ ...data, scope: "all" }, "mesa"));
  assert.throws(() =>
    mergeHistoryPages([
      result,
      { ...result, visit: { ...result.visit, id: r } },
    ]),
  );
});
test("query failures remain visible and never become fixtures or zero-valued success", async () => {
  const client = createClient("https://project.supabase.co", "public-key", {
    auth: { persistSession: false },
    global: {
      fetch: async () =>
        new Response(
          JSON.stringify({ code: "P0001", message: "SESSION_REQUIRED" }),
          { status: 403, headers: { "content-type": "application/json" } },
        ),
    },
  });
  await assert.rejects(
    () => fetchGuestHistory(client, "mesa"),
    (e) => e.reason === "SESSION_REQUIRED",
  );
});
test("pagination merges deduplicate events, preserve server aggregates and prefer current statuses", () => {
  const next = {
    ...data,
    orders: [
      { ...order, status: "accepted", updatedAt: "2026-10-14T13:00:00Z" },
    ],
  };
  const result = mergeHistoryPages([data, next]);
  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0].status, "accepted");
  assert.deepEqual(result.totals, data.totals);
  assert.throws(() => mergeHistoryPages([]));
  assert.throws(() =>
    mergeHistoryPages([
      data,
      { ...next, restaurant: { ...data.restaurant, id: "foreign" } },
    ]),
  );
});

test("reconciled older pages retain the newest PostgreSQL totals and snapshot version", () => {
  const newer = {
    ...data,
    fetchedAt: "2026-10-14T13:00:00Z",
    totals: {
      ...data.totals,
      confirmedMinor: 4700,
      pendingMinor: 0,
      confirmedCount: 2,
      pendingCount: 0,
    },
    orders: [
      { ...order, status: "accepted", updatedAt: "2026-10-14T13:00:00Z" },
    ],
  };
  const merged = mergeHistoryPages([data, newer]);
  assert.deepEqual(merged.totals, newer.totals);
  assert.equal(merged.fetchedAt, newer.fetchedAt);
  assert.equal(merged.orders[0].status, "accepted");
});
