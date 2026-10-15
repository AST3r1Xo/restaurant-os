import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  verifiedStaff,
  staffMemberships,
  selectStaffRestaurant,
} from "../src/features/staff/auth.ts";
import {
  staffCookieOptions,
  isStaffCookie,
} from "../src/lib/supabase/staff-cookie.ts";
import {
  guestCookieOptions,
  isGuestCookie,
} from "../src/lib/supabase/guest-cookie.ts";
import {
  queueOrders,
  decodeKitchenSnapshot,
  nextActions,
} from "../src/features/staff/model.ts";
import {
  fetchKitchen,
  changeOrderStatus,
} from "../src/features/staff/repository.ts";
import {
  createReconciler,
  newestSnapshot,
} from "../src/features/realtime/reconcile.ts";
const r = "11111111-1111-4111-8111-111111111111",
  other = "99999999-9999-4999-8999-999999999999";
const restaurant = {
  id: r,
  slug: "mesa",
  name: "Casa Mesa",
  role: "staff",
  currency: "EUR",
  timezone: "Europe/Lisbon",
};
const snapshot = {
  restaurantId: r,
  timezone: "Europe/Lisbon",
  fetchedAt: "2026-10-14T12:00:00.000Z",
  metrics: {
    pending: 1,
    preparing: 0,
    ready: 0,
    completedToday: 0,
    receivedToday: 1,
  },
  orders: [
    {
      id: "order1",
      restaurantId: r,
      reference: "REF1",
      tableLabel: "Table 04",
      currency: "EUR",
      totalMinor: 1400,
      status: "pending",
      createdAt: "2026-10-14T11:00:00.000Z",
      updatedAt: "2026-10-14T11:00:00.000Z",
      items: [
        {
          id: "line1",
          name: "Eggs",
          quantity: 1,
          unitPriceMinor: 1400,
          lineTotalMinor: 1400,
          options: [],
          notes: "",
        },
      ],
      notes: "",
      cancelReason: null,
    },
  ],
};
const auth = (user, error = null) => ({
  auth: {
    getUser: async () => ({ data: { user }, error }),
    getSession: () => {
      throw new Error("Never authorize from persisted sessions");
    },
  },
});
test("staff authorization requires a remotely verified confirmed permanent identity", async () => {
  assert.equal(
    (
      await verifiedStaff(
        auth({ id: "user", is_anonymous: false, email_confirmed_at: "today" }),
      )
    ).id,
    "user",
  );
  for (const user of [
    null,
    { id: "guest", is_anonymous: true, email_confirmed_at: "today" },
    { id: "staff", is_anonymous: false },
  ])
    await assert.rejects(() => verifiedStaff(auth(user)), /session/);
});
test("transient authentication errors are visible and do not become authorization", async () => {
  await assert.rejects(
    () => verifiedStaff(auth(null, { name: "AuthRetryableFetchError" })),
    /unavailable/,
  );
});
test("staff cookies cannot read, replace or sign out guest cookies", () => {
  const url = "https://project.supabase.co";
  const staff = staffCookieOptions(url),
    guest = guestCookieOptions(url);
  assert.notEqual(staff.name, guest.name);
  assert.ok(staff.httpOnly && guest.httpOnly);
  assert.ok(isStaffCookie(staff.name + ".0", url));
  assert.ok(!isStaffCookie(guest.name, url));
  assert.ok(!isGuestCookie(staff.name, url));
  assert.equal(staff.sameSite, "lax");
});
test("restaurant selection is a verified membership choice, never client authority", () => {
  assert.equal(selectStaffRestaurant([restaurant], other).id, r);
  assert.throws(() => selectStaffRestaurant([], r), /membership/);
  assert.throws(
    () => selectStaffRestaurant([restaurant], r, other),
    /workspace/,
  );
  assert.equal(
    selectStaffRestaurant([restaurant, { ...restaurant, id: other }], other).id,
    other,
  );
});
test("membership queries are scoped to the verified staff user", async () => {
  const requests = [];
  const client = createClient("https://project.supabase.co", "public-key", {
    auth: { persistSession: false },
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        requests.push(url);
        return new Response(
          JSON.stringify(
            url.pathname.endsWith("restaurant_members")
              ? [{ restaurant_id: r, role: "manager" }]
              : [{ ...restaurant, role: undefined }],
          ),
          { headers: { "content-type": "application/json" } },
        );
      },
    },
  });
  const members = await staffMemberships(client, "verified-user");
  assert.equal(members[0].role, "manager");
  assert.equal(requests[0].searchParams.get("user_id"), "eq.verified-user");
  assert.ok(requests[1].searchParams.get("id").includes(r));
});
test("kitchen snapshot decoding rejects foreign tenants and manipulated totals", () => {
  assert.equal(
    decodeKitchenSnapshot(structuredClone(snapshot), r).orders.length,
    1,
  );
  assert.throws(() => decodeKitchenSnapshot(snapshot, other));
  const forged = structuredClone(snapshot);
  forged.orders[0].totalMinor = 1;
  assert.throws(() => decodeKitchenSnapshot(forged, r));
});
test("queue reconciliation deduplicates entries, sorts oldest active and newest completed", () => {
  const old = snapshot.orders[0],
    recent = {
      ...old,
      id: "order2",
      createdAt: "2026-10-14T11:30:00.000Z",
      updatedAt: "2026-10-14T12:00:00.000Z",
    };
  assert.deepEqual(
    queueOrders([recent, old, old], "pending").map((o) => o.id),
    ["order1", "order2"],
  );
  assert.deepEqual(
    queueOrders(
      [
        { ...old, status: "served" },
        { ...recent, status: "cancelled" },
      ],
      "completed",
    ).map((o) => o.id),
    ["order2", "order1"],
  );
  assert.equal(
    queueOrders(
      [
        { ...old, status: "accepted" },
        { ...recent, status: "preparing" },
      ],
      "preparing",
    ).length,
    2,
  );
});
test("operational UI offers only the current next action and terminal states have none", () => {
  assert.equal(nextActions.pending.status, "accepted");
  assert.equal(nextActions.accepted.status, "preparing");
  assert.equal(nextActions.preparing.status, "ready");
  assert.equal(nextActions.ready.status, "served");
  assert.equal(nextActions.served, undefined);
  assert.equal(nextActions.cancelled, undefined);
});
test("status requests include expected state and no financial or ownership edits", async () => {
  let sent;
  const client = createClient("https://project.supabase.co", "public-key", {
    auth: { persistSession: false },
    global: {
      fetch: async (_input, init) => {
        sent = JSON.parse(init.body);
        return new Response("{}", {
          headers: { "content-type": "application/json" },
        });
      },
    },
  });
  await changeOrderStatus(client, r, {
    orderId: "order1",
    expectedStatus: "pending",
    nextStatus: "accepted",
  });
  assert.deepEqual(sent, {
    target_restaurant: r,
    target_order: "order1",
    expected_status: "pending",
    next_status: "accepted",
  });
});
test("live query failures never become fixture kitchen data", async () => {
  const client = createClient("https://project.supabase.co", "public-key", {
    auth: { persistSession: false },
    global: {
      fetch: async () =>
        new Response(
          JSON.stringify({ code: "P0001", message: "STAFF_FORBIDDEN" }),
          { status: 403, headers: { "content-type": "application/json" } },
        ),
    },
  });
  await assert.rejects(
    () => fetchKitchen(client, r),
    (e) => e.code === "STAFF_FORBIDDEN",
  );
});
test("bursts and reconnect invalidations coalesce without losing events during an in-flight fetch", async () => {
  let release,
    calls = 0;
  const gate = new Promise((resolve) => (release = resolve));
  const controller = createReconciler(async () => {
    calls++;
    if (calls === 1) await gate;
  });
  const first = controller.refresh();
  await controller.refresh();
  await controller.refresh();
  release();
  await first;
  assert.equal(calls, 2);
  await controller.refresh();
  assert.equal(calls, 3);
  controller.stop();
  await controller.refresh();
  assert.equal(calls, 3);
});
test("failed reconciliation can safely refetch an authoritative snapshot on reconnect", async () => {
  let calls = 0;
  const c = createReconciler(async () => {
    if (++calls === 1) throw new Error("Offline");
  });
  await assert.rejects(() => c.refresh(), /Offline/);
  await c.refresh();
  assert.equal(calls, 2);
});
test("out-of-order snapshots never regress an already confirmed status", () => {
  const old = { updatedAt: "2026-10-14T11:00:00Z", status: "pending" },
    current = { updatedAt: "2026-10-14T12:00:00Z", status: "served" };
  assert.equal(newestSnapshot(current, old).status, "served");
  assert.equal(newestSnapshot(old, current).status, "served");
  assert.equal(
    newestSnapshot(
      { fetchedAt: "2026-10-14T12:00:00Z" },
      { fetchedAt: "2026-10-14T11:00:00Z" },
    ).fetchedAt,
    "2026-10-14T12:00:00Z",
  );
});
