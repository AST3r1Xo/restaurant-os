import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import {
  guestNotices,
  staffNotices,
  sortNotices,
} from "../src/features/notifications/model.ts";
import { createNotificationStore } from "../src/features/notifications/store.ts";
import { fetchGuestActivity } from "../src/features/notifications/repository.ts";
import { GuestSessionError } from "../src/features/orders/guest-auth.ts";
import { validateOrderOrigin } from "../src/features/orders/request-protection.ts";

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const r = id(1),
  guest = id(2),
  visit = id(3),
  token = id(4),
  visitKey = id(5);
const at = "2026-10-20T12:00:00.000Z";
const input = { slug: "mesa", restaurantId: r, tableToken: token, visitKey };
const activity = (status = "pending") => ({
  restaurantId: r,
  identityKey: "opaque-guest-visit",
  visitId: visit,
  fetchedAt: at,
  orders: [{ id: id(6), status, createdAt: at, updatedAt: at }],
  request: null,
});
const notice = (number, extra = {}) => ({
  id: `test:${number}`,
  title: `Notice ${number}`,
  message: "A useful update",
  href: "/admin",
  action: "Open kitchen",
  at,
  tone: "attention",
  ...extra,
});
const totals = {
  orderValueMinor: 100,
  pendingMinor: 100,
  confirmedMinor: 0,
  cancelledMinor: 0,
  orderCount: 1,
  pendingCount: 1,
  confirmedCount: 0,
  cancelledCount: 0,
  unfinishedCount: 1,
};
const workspace = () => ({
  restaurantId: r,
  currency: "EUR",
  timezone: "Europe/Lisbon",
  fetchedAt: at,
  tables: [
    {
      id: id(7),
      label: "Table 04",
      isActive: true,
      session: {
        id: visit,
        tableId: id(7),
        tableLabel: "Table 04",
        currency: "EUR",
        status: "active",
        openedAt: at,
        closedAt: null,
        updatedAt: at,
        totals,
        request: null,
      },
    },
  ],
  history: [],
  nextCursor: null,
  requests: [],
});

test("guest alerts never announce internal preparation or readiness", () => {
  const sent = guestNotices(activity(), "mesa", token);
  for (const status of ["accepted", "preparing", "ready"])
    assert.deepEqual(guestNotices(activity(status), "mesa", token), sent);
  assert.match(sent[0].title, /received/);
  assert.doesNotMatch(
    JSON.stringify(sent),
    /ready|preparing|countdown|ETA|minute/,
  );
  assert.match(sent[0].href, /\/orders\?table=/);
});
test("actual service and cancellation create distinct, actionable guest updates", () => {
  const served = guestNotices(activity("served"), "mesa")[0];
  const cancelled = guestNotices(activity("cancelled"), "mesa")[0];
  assert.match(served.title, /served/);
  assert.equal(served.tone, "success");
  assert.match(cancelled.title, /cancelled/);
  assert.equal(cancelled.tone, "danger");
  assert.notEqual(served.id, cancelled.id);
  assert.equal(cancelled.href, "/r/mesa/orders");
});
test("no participant or active visit means no private customer alerts", () => {
  assert.deepEqual(guestNotices({ ...activity(), visitId: null }, "mesa"), []);
  assert.deepEqual(
    guestNotices({ ...activity(), identityKey: null }, "mesa"),
    [],
  );
});
test("bill request acknowledgement is distinguished from request delivery without payment claims", () => {
  const a = activity();
  a.request = {
    id: id(8),
    status: "requested",
    requestedAt: at,
    acknowledgedAt: null,
  };
  const requested = guestNotices(a, "mesa").find((n) =>
    n.id.startsWith("bill:"),
  );
  assert.match(requested.title, /your table/);
  assert.doesNotMatch(requested.title, /^Your bill request/);
  a.request.status = "acknowledged";
  a.request.acknowledgedAt = "2026-10-20T12:01:00Z";
  const acknowledged = guestNotices(a, "mesa").find((n) =>
    n.id.startsWith("bill:"),
  );
  assert.notEqual(requested.id, acknowledged.id);
  assert.match(acknowledged.title, /Staff have seen/);
  assert.equal(acknowledged.href, "/r/mesa/bill");
  assert.doesNotMatch(
    JSON.stringify(acknowledged),
    /paid|payment successful|amount due/,
  );
});
test("guest alerts contain no guest identities, notes, dishes or private receipt references", () => {
  const a = activity();
  Object.assign(a.orders[0], {
    customerId: "PRIVATE ID",
    notes: "PRIVATE NOTE",
    reference: "PRIVATE RECEIPT",
    items: ["PRIVATE DISH"],
  });
  assert.doesNotMatch(JSON.stringify(guestNotices(a, "mesa")), /PRIVATE/);
});
test("staff order notifications are built from active table snapshots only", () => {
  const w = workspace();
  const initial = staffNotices(w);
  assert.equal(initial.length, 1);
  assert.equal(initial[0].href, "/admin");
  assert.match(initial[0].title, /Table 04/);
  const next = structuredClone(w);
  next.tables[0].session.totals.orderCount = 3;
  assert.match(staffNotices(next, w)[0].title, /2 new orders/);
  next.tables[0].session.totals.unfinishedCount = 0;
  assert.deepEqual(staffNotices(next), []);
  next.tables[0].session = null;
  assert.deepEqual(staffNotices(next), []);
});
test("staff bill requests link to their immediate response area and vanish after acknowledgement", () => {
  const w = workspace();
  w.requests = [
    {
      id: id(9),
      sessionId: visit,
      tableId: id(7),
      tableLabel: "Table 04",
      requestedAt: at,
    },
  ];
  const request = staffNotices(w).find((n) => n.id.startsWith("bill:"));
  assert.match(request.title, /Table 04 has requested the bill/);
  assert.equal(request.href, "/admin/tables#bill-requests");
  w.requests = [];
  assert.ok(!staffNotices(w).some((n) => n.id.startsWith("bill:")));
});
test("notification lists sort, deduplicate and cap visible alerts", () => {
  const list = sortNotices([
    ...Array.from({ length: 50 }, (_, i) =>
      notice(i, { at: new Date(Date.parse(at) + i * 1000).toISOString() }),
    ),
    notice(49, { at: "2026-10-20T13:00:00Z" }),
  ]);
  assert.equal(list.length, 30);
  assert.equal(list[0].id, "test:49");
  assert.equal(new Set(list.map((n) => n.id)).size, 30);
});
test("initial snapshots populate the inbox without an arrival toast", () => {
  const store = createNotificationStore("initial-test");
  store.replace([notice(1)]);
  assert.equal(store.getSnapshot().unread, 1);
  assert.equal(store.getSnapshot().toast, null);
});
test("duplicate events and reconciliations never repeat an alert or reset its timer identity", () => {
  const store = createNotificationStore("duplicate-test");
  store.replace([]);
  store.replace([notice(1)]);
  const toast = store.getSnapshot().toast;
  assert.equal(toast.id, "test:1");
  store.replace([notice(1), notice(1)]);
  assert.equal(store.getSnapshot().notices.length, 1);
  assert.equal(store.getSnapshot().toast, toast);
  store.dismissToast();
  store.replace([notice(1)]);
  assert.equal(store.getSnapshot().toast, null);
});
test("read markers survive navigation in memory, without persisting private payloads", () => {
  const store = createNotificationStore("route-test");
  store.replace([notice(1)]);
  store.read();
  const next = createNotificationStore("route-test");
  next.replace([notice(1)]);
  assert.equal(next.getSnapshot().unread, 0);
  assert.equal(next.getSnapshot().toast, null);
  assert.deepEqual(next.getServerSnapshot(), {
    notices: [],
    unread: 0,
    toast: null,
  });
});
test("restaurant and guest visit scopes have independent unread states", () => {
  const first = createNotificationStore("scope-a"),
    second = createNotificationStore("scope-b");
  first.replace([notice(1)]);
  first.read();
  second.replace([notice(1)]);
  assert.equal(first.getSnapshot().unread, 0);
  assert.equal(second.getSnapshot().unread, 1);
});
test("offline concealment clears visible data; reconnect restores only authoritative current records", () => {
  const store = createNotificationStore("offline-test");
  store.replace([notice(1)]);
  store.suspend();
  assert.equal(store.getSnapshot().notices.length, 0);
  assert.equal(store.getSnapshot().toast, null);
  store.replace([notice(2)]);
  assert.equal(store.getSnapshot().notices.length, 1);
  assert.equal(store.getSnapshot().notices[0].id, "test:2");
});
test("visit revocation removes data and read markers; no previous payload enters a fresh visit", () => {
  const store = createNotificationStore("revoked-test");
  store.replace([notice(1)]);
  store.read();
  store.revoke();
  assert.equal(store.getSnapshot().notices.length, 0);
  store.replace([notice(2)]);
  assert.equal(store.getSnapshot().toast, null);
  assert.equal(store.getSnapshot().unread, 1);
});
test("resolved staff requests are removed from the inbox and any active toast", () => {
  const store = createNotificationStore("resolved-test");
  store.replace([]);
  store.replace([notice(1)]);
  store.replace([]);
  assert.deepEqual(store.getSnapshot(), {
    notices: [],
    unread: 0,
    toast: null,
  });
});
test("demo snapshots never generate live arrival toasts", () => {
  const store = createNotificationStore("demo-test");
  store.replace([], false);
  store.replace([notice(1)], false);
  assert.equal(store.getSnapshot().toast, null);
});
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const waitingBill = () => ({
  id: visit,
  restaurantId: r,
  tableLabel: "Table 04",
  currency: "EUR",
  access: "waiting",
  openedAt: at,
  closedAt: null,
  fetchedAt: at,
});
function client(handler) {
  return createClient("https://test.supabase.co", "publishable-test", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (url, init) => handler(new URL(String(url)), init) },
  });
}
function defaultTransport(url) {
  if (url.pathname.endsWith("resolve_table_visit"))
    return json([{ table_label: "Table 04", visit_key: visitKey }]);
  if (url.pathname.endsWith("get_guest_table_bill")) return json(waitingBill());
  assert.equal(url.pathname, "/rest/v1/orders");
  assert.equal(
    url.searchParams.get("select"),
    "id,status,created_at,updated_at",
  );
  assert.equal(url.searchParams.get("restaurant_id"), `eq.${r}`);
  assert.equal(url.searchParams.get("customer_id"), `eq.${guest}`);
  assert.equal(url.searchParams.get("session_id"), `eq.${visit}`);
  return json([
    { id: id(6), status: "pending", created_at: at, updated_at: at },
  ]);
}
test("guest signals reuse QR/participant authorization and query only the verified guest in the right active visit", async () => {
  const result = await fetchGuestActivity(
    client(defaultTransport),
    guest,
    input,
  );
  assert.equal(result.visitId, visit);
  assert.equal(result.orders.length, 1);
  assert.match(result.identityKey, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(result).includes(guest));
  assert.equal(result.request, null);
});
test("a QR alone without session participation never queries another guest's orders", async () => {
  const result = await fetchGuestActivity(
    client((url, init) =>
      url.pathname.endsWith("get_guest_table_bill")
        ? json(null)
        : defaultTransport(url, init),
    ),
    guest,
    input,
  );
  assert.equal(result.visitId, null);
  assert.deepEqual(result.orders, []);
});
test("invalid QR or stale visit generations are stopped before participant and order reads", async () => {
  for (const rows of [[], [{ table_label: "Table 04", visit_key: id(99) }]]) {
    let calls = 0;
    const result = await fetchGuestActivity(
      client((url) => {
        calls++;
        assert.ok(url.pathname.endsWith("resolve_table_visit"));
        return json(rows);
      }),
      guest,
      input,
    );
    assert.equal(calls, 1);
    assert.equal(result.visitId, null);
  }
});
test("a mismatched restaurant is rejected rather than accepting an RPC result from another tenant", async () => {
  await assert.rejects(() =>
    fetchGuestActivity(
      client((url, init) =>
        url.pathname.endsWith("get_guest_table_bill")
          ? json({ ...waitingBill(), restaurantId: id(90) })
          : defaultTransport(url, init),
      ),
      guest,
      input,
    ),
  );
});
test("closure during a refresh clears the old notification scope when RLS returns no orders", async () => {
  const result = await fetchGuestActivity(
    client((url, init) =>
      url.pathname.endsWith("/orders") ? json([]) : defaultTransport(url, init),
    ),
    guest,
    input,
  );
  assert.equal(result.identityKey, null);
  assert.equal(result.visitId, null);
});
test("minimal guest signals paginate beyond the public API's first page", async () => {
  let pages = 0;
  const result = await fetchGuestActivity(
    client((url, init) => {
      if (!url.pathname.endsWith("/orders")) return defaultTransport(url, init);
      pages++;
      const offset = Number(url.searchParams.get("offset"));
      return json(
        Array.from({ length: offset === 0 ? 250 : 1 }, (_, n) => ({
          id: id(100 + offset + n),
          status: "served",
          created_at: at,
          updated_at: at,
        })),
      );
    }),
    guest,
    input,
  );
  assert.equal(pages, 2);
  assert.equal(result.orders.length, 251);
});
test("network/SQL errors remain errors rather than fake successful notification snapshots", async () => {
  await assert.rejects(() =>
    fetchGuestActivity(
      client((url, init) =>
        url.pathname.endsWith("/orders")
          ? json({ message: "database unavailable", code: "XX000" }, 500)
          : defaultTransport(url, init),
      ),
      guest,
      input,
    ),
  );
});
test("approved bill acknowledgement is reduced to a signal without shared item data", async () => {
  const result = await fetchGuestActivity(
    client((url, init) => {
      if (!url.pathname.endsWith("get_guest_table_bill"))
        return defaultTransport(url, init);
      return json({
        ...waitingBill(),
        access: "active",
        totals,
        lines: [
          {
            key: "a".repeat(32),
            name: "PRIVATE SHARED DISH",
            quantity: 1,
            basePriceMinor: 100,
            unitPriceMinor: 100,
            lineTotalMinor: 100,
            status: "pending",
            options: [],
          },
        ],
        request: {
          id: id(8),
          status: "acknowledged",
          requestedAt: at,
          acknowledgedAt: at,
        },
      });
    }),
    guest,
    input,
  );
  assert.equal(result.request.status, "acknowledged");
  assert.doesNotMatch(
    JSON.stringify(result),
    /PRIVATE SHARED DISH|totals|lineTotalMinor/,
  );
});
const require = createRequire(import.meta.url);
async function load(path, dependencies = {}) {
  const source = await readFile(path, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)(
    (name) => dependencies[name] ?? require(name),
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}
async function action({
  mode = "live",
  origin = "http://localhost:3000",
  identity = guest,
  error,
} = {}) {
  let reads = 0,
    creation;
  const { guestActivityAction } = await load(
    "src/features/notifications/actions.ts",
    {
      "next/headers": {
        headers: async () => new Headers({ origin, host: "localhost:3000" }),
      },
      "@/lib/env": { getDataMode: () => mode },
      "@/lib/supabase/guest": { createGuestClient: async () => ({}) },
      "@/features/orders/guest-auth": {
        GuestSessionError,
        verifiedGuest: async (c, allowCreate) => {
          creation = allowCreate;
          if (error) throw error;
          return { id: identity };
        },
      },
      "@/features/orders/request-protection": { validateOrderOrigin },
      "@/features/orders/payload": await import(
        "../src/features/orders/payload.ts"
      ),
      "./repository": {
        emptyActivity: (restaurantId) => ({
          restaurantId,
          identityKey: null,
          visitId: null,
          fetchedAt: at,
          orders: [],
          request: null,
        }),
        fetchGuestActivity: async (c, user) => {
          reads++;
          assert.equal(user, identity);
          return activity();
        },
      },
    },
  );
  return {
    run: guestActivityAction,
    reads: () => reads,
    creation: () => creation,
  };
}
test("the server derives guest identity and never creates anonymous sessions just for notifications", async () => {
  const a = await action();
  assert.equal((await a.run(input)).ok, true);
  assert.equal(a.reads(), 1);
  assert.equal(a.creation(), false);
  const missing = await action({ error: new GuestSessionError("lost") });
  const result = await missing.run(input);
  assert.equal(result.ok, true);
  assert.equal(result.value.visitId, null);
  assert.equal(missing.reads(), 0);
});
test("notification actions reject injected ownership, malformed contexts, demo calls and foreign origins", async () => {
  for (const context of [
    { ...input, guestId: id(90) },
    { ...input, restaurantId: "../bad" },
    { ...input, tableToken: "bad" },
    { ...input, tableToken: undefined, visitKey },
  ]) {
    const a = await action();
    assert.equal((await a.run(context)).ok, false);
    assert.equal(a.reads(), 0);
  }
  for (const options of [
    { mode: "demo" },
    { origin: "https://attacker.example" },
  ]) {
    const a = await action(options);
    assert.equal((await a.run(input)).ok, false);
    assert.equal(a.reads(), 0);
  }
});
test("transient Auth errors do not grant access, replace identity or expose internal errors", async () => {
  const a = await action({ error: new Error("PRIVATE DATABASE ERROR") });
  const result = await a.run(input);
  assert.equal(result.ok, false);
  assert.equal(result.code, "unavailable");
  assert.equal(a.reads(), 0);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});
test("demo and initial menu rendering never load the guest Realtime transport or create Auth sessions", async () => {
  let imports = 0,
    calls = 0;
  const { CustomerNotifications } = await load(
    "src/features/notifications/components/customer-notifications.tsx",
    {
      "next/dynamic": () => () => {
        imports++;
        return null;
      },
      "@/features/cart/components/cart-provider": {
        useCart: () => ({
          context: { mode: "demo", table: { status: "missing" } },
          menu: { id: r, slug: "mesa" },
        }),
      },
      "../actions": {
        guestActivityAction: () => {
          calls++;
          throw new Error("Demo attempted a live Auth/data call");
        },
      },
      "../model": { guestNotices },
      "./notification-center": {
        NotificationProvider: ({ children }) => children,
      },
    },
  );
  const html = renderToStaticMarkup(
    createElement(
      CustomerNotifications,
      null,
      createElement("input", { defaultValue: "Preserved ordering draft" }),
    ),
  );
  assert.match(html, /Preserved ordering draft/);
  assert.equal(imports, 0);
  assert.equal(calls, 0);
});
test("notification UI starts with an empty SSR snapshot, supports a labelled modal, and preserves children", async () => {
  const { actionClass } = await load("src/components/action-button.tsx");
  const { NotificationProvider, NotificationBell } = await load(
    "src/features/notifications/components/notification-center.tsx",
    {
      "../store": { createNotificationStore },
      "@/components/action-button": { actionClass },
    },
  );
  const html = renderToStaticMarkup(
    createElement(
      NotificationProvider,
      {
        scope: "ssr-test",
        notices: [notice(1, { title: "PRIVATE ALERT" })],
        description: "Current visit only",
        guest: true,
        available: false,
      },
      createElement(
        "main",
        null,
        createElement("input", { defaultValue: "Draft stays mounted" }),
        createElement(NotificationBell),
      ),
    ),
  );
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /<dialog[^>]+aria-labelledby/);
  assert.match(html, /Close notifications/);
  assert.match(html, /Draft stays mounted/);
  assert.doesNotMatch(html, /PRIVATE ALERT/);
});

async function customerShell() {
  const restaurant = {
    id: r,
    slug: "mesa",
    name: "Casa Mesa",
    currency: "EUR",
    isAcceptingOrders: false,
  };
  const menu = { ...restaurant, categories: [], products: [] };
  const context = {
    mode: "live",
    restaurant,
    table: { status: "valid", label: "Table 04", token, visitKey },
  };
  const { CustomerShell } = await load(
    "src/features/menu/components/customer-shell.tsx",
    {
      "@/components/navigation/customer-navigation": {
        CustomerNavigation: () =>
          createElement("header", null, "Customer navigation"),
        CustomerFooter: () => null,
      },
      "../queries": { getMenu: async () => menu },
      "next/navigation": {
        notFound: () => {
          throw new Error("not found");
        },
      },
      "@/features/cart/components/cart-provider": {
        CartProvider: ({ children }) => children,
        CartNotice: () => null,
      },
      "@/features/cart/components/cart-access": { CartAccess: () => null },
      "@/features/orders/history/queries": {
        getGuestHistory: async () => ({
          visit: { id: visit },
          totals: { orderCount: 1 },
        }),
      },
      "./restaurant-closed": {
        RestaurantClosed: () =>
          createElement("main", null, "Branded restaurant closed"),
      },
      "@/features/notifications/components/customer-notifications": {
        CustomerNotifications: ({ children }) => children,
      },
    },
  );
  return { CustomerShell, menu, context };
}
test("a closed restaurant still blocks new QR/menu entry even for an existing guest", async () => {
  const { CustomerShell, menu, context } = await customerShell();
  const tree = await CustomerShell({
    context,
    menuOverride: menu,
    children: createElement("p", null, "ORDERING MENU"),
  });
  const html = renderToStaticMarkup(tree);
  assert.match(html, /Branded restaurant closed/);
  assert.doesNotMatch(html, /ORDERING MENU|Customer navigation/);
});
test("authorized visit screens remain reachable after restaurant closing, without reopening order entry", async () => {
  const { CustomerShell, menu, context } = await customerShell();
  const tree = await CustomerShell({
    context,
    menuOverride: menu,
    visitOnly: true,
    children: createElement("section", null, "AUTHORIZED CURRENT VISIT"),
  });
  const html = renderToStaticMarkup(tree);
  assert.match(html, /AUTHORIZED CURRENT VISIT/);
  assert.match(html, /restaurant is closed to new orders/);
  assert.doesNotMatch(html, /Branded restaurant closed/);
  assert.equal(context.restaurant.isAcceptingOrders, false);
});
