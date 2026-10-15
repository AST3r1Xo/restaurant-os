import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  decodeGuestBill,
  decodeTotals,
  decodeWorkspace,
  fetchGuestBill,
  fetchWorkspace,
  fetchSessionOrders,
} from "../src/features/sessions/repository.ts";
const r = "11111111-1111-4111-8111-111111111111",
  s = "70000000-0000-4000-8000-000000000001",
  t = "22222222-2222-4222-8222-222222222221",
  token = "67006a2d-d1c1-4ba2-918f-fb8e4ffb1b5c",
  date = "2026-10-15T12:00:00Z";
const totals = {
  orderValueMinor: 4200,
  confirmedMinor: 1400,
  pendingMinor: 2800,
  cancelledMinor: 500,
  orderCount: 4,
  confirmedCount: 1,
  pendingCount: 2,
  cancelledCount: 1,
  unfinishedCount: 3,
};
const bill = {
  id: s,
  restaurantId: r,
  tableLabel: "Table 04",
  currency: "EUR",
  access: "active",
  openedAt: date,
  closedAt: null,
  fetchedAt: date,
  totals,
  lines: [
    {
      key: "a".repeat(32),
      name: "Eggs",
      quantity: 1,
      basePriceMinor: 1400,
      unitPriceMinor: 1400,
      lineTotalMinor: 1400,
      status: "accepted",
      options: [],
    },
    {
      key: "b".repeat(32),
      name: "Eggs",
      quantity: 2,
      basePriceMinor: 1400,
      unitPriceMinor: 1400,
      lineTotalMinor: 2800,
      status: "pending",
      options: [],
    },
    {
      key: "c".repeat(32),
      name: "Juice",
      quantity: 1,
      basePriceMinor: 500,
      unitPriceMinor: 500,
      lineTotalMinor: 500,
      status: "cancelled",
      options: [],
    },
  ],
  request: null,
};
const session = {
  id: s,
  tableId: t,
  tableLabel: "Table 04",
  currency: "EUR",
  status: "active",
  openedAt: date,
  closedAt: null,
  updatedAt: date,
  totals,
  request: null,
};
const ws = {
  restaurantId: r,
  currency: "EUR",
  timezone: "Europe/Lisbon",
  fetchedAt: date,
  tables: [{ id: t, label: "Table 04", isActive: true, session }],
  history: [],
  nextCursor: null,
  requests: [],
};
function client(handler) {
  return createClient("https://project.supabase.co", "public-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) =>
        handler(new URL(String(input)), JSON.parse(init.body)),
    },
  });
}
const response = (v, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "content-type": "application/json" },
  });
test("shared totals preserve database amounts and enforce integer, status and cancellation invariants", () => {
  assert.deepEqual(decodeTotals(totals), totals);
  for (const change of [
    (v) => (v.orderValueMinor = 1),
    (v) => (v.pendingMinor = -1),
    (v) => (v.confirmedMinor = 1.5),
    (v) => (v.orderCount = 0),
    (v) => (v.unfinishedCount = 99),
    (v) => (v.orderValueMinor = Number.MAX_SAFE_INTEGER + 1),
  ]) {
    const v = structuredClone(totals);
    change(v);
    assert.throws(() => decodeTotals(v));
  }
});
test("guest snapshots reject wrong restaurants, invalid states and closed-session aggregate disclosures", () => {
  assert.equal(decodeGuestBill(bill, r).totals.orderValueMinor, 4200);
  assert.throws(() => decodeGuestBill(bill, s));
  assert.throws(() =>
    decodeGuestBill({ ...bill, access: "closed", closedAt: date }, r),
  );
  assert.throws(() => decodeGuestBill({ ...bill, closedAt: date }, r));
  const base = { ...bill };
  delete base.totals;
  delete base.request;
  delete base.lines;
  assert.equal(
    decodeGuestBill({ ...base, access: "waiting" }, r).totals,
    undefined,
  );
  assert.equal(
    decodeGuestBill({ ...base, access: "closed", closedAt: date }, r).access,
    "closed",
  );
});
test("guest DTOs share whitelisted dish snapshots without identities or private receipts", () => {
  const decoded = decodeGuestBill(
    {
      ...bill,
      guestId: "private",
      orders: [{ secret: true }],
      items: ["private"],
      lines: bill.lines.map((line) => ({
        ...line,
        guestId: "private",
        orderId: "private",
      })),
    },
    r,
  );
  assert.equal(decoded.guestId, undefined);
  assert.equal(decoded.orders, undefined);
  assert.equal(decoded.items, undefined);
  assert.deepEqual(decoded.lines, bill.lines);
});
test("shared dish decoding verifies stored line arithmetic and complete status totals", () => {
  for (const mutate of [
    (v) => v.lines.pop(),
    (v) => v.lines[0].quantity++,
    (v) =>
      v.lines[0].options.push({
        name: "Extra",
        groupName: "Extras",
        priceAdjustmentMinor: 250,
      }),
    (v) => (v.lines[1].status = "served"),
    (v) => (v.lines[0].lineTotalMinor = 1),
    (v) => v.lines.push(v.lines[0]),
  ]) {
    const value = structuredClone(bill);
    mutate(value);
    assert.throws(() => decodeGuestBill(value, r));
  }
});
test("table workspace decoding binds active sessions to their table and rejects other restaurants", () => {
  assert.equal(decodeWorkspace(ws, r).tables[0].session.id, s);
  assert.throws(() => decodeWorkspace(ws, s));
  const v = structuredClone(ws);
  v.tables[0].session.tableId = r;
  assert.throws(() => decodeWorkspace(v, r));
  const duplicate = structuredClone(ws);
  duplicate.tables.push(duplicate.tables[0]);
  assert.throws(() => decodeWorkspace(duplicate, r));
});
test("guest bill requests carry context only, without ownership claims or client prices", async () => {
  let sent;
  const c = client((url, args) => {
    sent = { path: url.pathname, args };
    return response(bill);
  });
  await fetchGuestBill(c, "mesa", r, token);
  assert.deepEqual(sent, {
    path: "/rest/v1/rpc/get_guest_table_bill",
    args: { restaurant_slug: "mesa", table_token: token },
  });
  await assert.rejects(() => fetchGuestBill(c, "mesa", r, "invalid"));
  await assert.rejects(() => fetchGuestBill(c, "../mesa", r));
});
test("workspace and historical order requests are tenant- and cursor-scoped", async () => {
  const requests = [];
  const c = client((url, args) => {
    requests.push({ path: url.pathname, args });
    return response(
      url.pathname.endsWith("get_table_workspace")
        ? ws
        : {
            restaurantId: r,
            sessionId: s,
            orders: [],
            nextCursor: null,
            fetchedAt: date,
          },
    );
  });
  await fetchWorkspace(c, r, s);
  await fetchSessionOrders(c, r, s, t);
  assert.deepEqual(
    requests.map((x) => x.args),
    [
      { target_restaurant: r, before_session: s },
      { target_restaurant: r, target_session: s, before_order: t },
    ],
  );
  await assert.rejects(() => fetchSessionOrders(c, r, "invalid"));
});
test("live failures stay actionable rather than becoming fixtures, empty success or a false request acknowledgement", async () => {
  const c = client(() =>
    response({ code: "P0001", message: "STAFF_FORBIDDEN" }, 403),
  );
  await assert.rejects(
    () => fetchWorkspace(c, r),
    (e) => e.code === "STAFF_FORBIDDEN",
  );
  const other = client(() =>
    response({ code: "XX999", message: "private internal error" }, 500),
  );
  await assert.rejects(
    () => fetchGuestBill(other, "mesa", r),
    (e) => e.code === "UNAVAILABLE" && !e.message.includes("private internal"),
  );
});

test("stale-visit failures retain a bounded, definitive instruction to review again", async () => {
  const { orderFailure } = await import("../src/features/orders/errors.ts");
  const { OrderRepositoryError } =
    await import("../src/features/orders/repository.ts");
  const failure = orderFailure(new OrderRepositoryError("SESSION_CHANGED"));
  assert.equal(failure.code, "session_changed");
  assert.equal(failure.refresh, true);
  assert.match(failure.message, /visit has ended/);
});
