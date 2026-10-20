import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { fetchDailyReport } from "../src/features/reports/repository.ts";

// Read-only restaurant verification; no orders/menu/session data are modified.
const project = "ahkleoidhzcsubsdlqbn";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(new URL(url).hostname, `${project}.supabase.co`);
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const client = () =>
  createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
async function ok(p, label) {
  const { data, error } = await p;
  if (error)
    throw new Error(
      `${label}: ${error.code ?? "unavailable"}; credentials withheld`,
    );
  return data;
}
const checks = [];
function pass(label) {
  checks.push(label);
  console.log(`PASS ${label}`);
}
const staff = client();
await ok(
  staff.auth.signInWithPassword({
    email: process.env.STAFF_TEST_EMAIL.trim(),
    password: process.env.STAFF_TEST_PASSWORD,
  }),
  "Staff sign-in",
);
const { user } = await ok(staff.auth.getUser(), "Verified staff");
assert.ok(user && !user.is_anonymous);
const r = "11111111-1111-4111-8111-111111111111";
const today = await fetchDailyReport(staff, r, {});
assert.equal(today.day, today.today);
pass(
  "actual owner reads today's Casa Mesa report through ordinary staff authorization",
);
const dateKey = (value) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: today.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
const existing = [];
for (let from = 0; ; from += 500) {
  const rows = await ok(
    staff
      .from("orders")
      .select("id,status,total_minor,currency,created_at")
      .eq("restaurant_id", r)
      .order("created_at")
      .order("id")
      .range(from, from + 499),
    "Authorized historical rows",
  );
  existing.push(...rows);
  if (rows.length < 500) break;
  assert.ok(from < 10000, "Bounded development verification only");
}
const days = [...new Set(existing.map((o) => dateKey(o.created_at)))].sort();
for (const day of days) {
  const report = await fetchDailyReport(staff, r, { day });
  const rows = existing.filter(
    (o) => dateKey(o.created_at) === day && o.currency === report.currency,
  );
  const confirmed = rows.filter((o) =>
    ["accepted", "preparing", "ready", "served"].includes(o.status),
  );
  assert.equal(report.totals.orderCount, rows.length);
  assert.equal(
    report.totals.confirmedMinor,
    confirmed.reduce((n, o) => n + o.total_minor, 0),
  );
  assert.equal(
    report.totals.pendingMinor,
    rows
      .filter((o) => o.status === "pending")
      .reduce((n, o) => n + o.total_minor, 0),
  );
  assert.equal(
    report.totals.cancelledMinor,
    rows
      .filter((o) => o.status === "cancelled")
      .reduce((n, o) => n + o.total_minor, 0),
  );
  const confirmedIds = new Set(confirmed.map((o) => o.id));
  const items = await ok(
    staff
      .from("order_items")
      .select("order_id,product_id,quantity,line_total_minor")
      .eq("restaurant_id", r)
      .in(
        "order_id",
        rows.map((o) => o.id),
      ),
    "Authorized item snapshots",
  );
  const expected = new Map();
  for (const i of items.filter((i) => confirmedIds.has(i.order_id))) {
    const p = expected.get(i.product_id) ?? {
      quantity: 0,
      totalMinor: 0,
      orders: new Set(),
    };
    p.quantity += i.quantity;
    p.totalMinor += i.line_total_minor;
    p.orders.add(i.order_id);
    expected.set(i.product_id, p);
  }
  assert.equal(report.products.length, expected.size);
  for (const p of report.products) {
    const source = expected.get(p.productId);
    assert.equal(p.quantity, source.quantity);
    assert.equal(p.totalMinor, source.totalMinor);
    assert.equal(p.orderCount, source.orders.size);
  }
  const seen = new Set();
  let page = report;
  for (;;) {
    for (const o of page.orders) {
      assert.ok(!seen.has(o.id));
      seen.add(o.id);
    }
    if (!page.nextCursor) break;
    page = await fetchDailyReport(staff, r, {
      day,
      currency: report.currency,
      before: page.nextCursor,
    });
    assert.deepEqual(page.totals, report.totals);
  }
  assert.equal(seen.size, rows.length);
}
pass(
  `all ${days.length} recorded local-calendar days match PostgreSQL order totals, item quantities and per-product values`,
);
pass(
  "full historical receipt lists match authorized rows with no missing/duplicate order IDs",
);
const empty = await fetchDailyReport(staff, r, { day: "2000-01-01" });
assert.equal(empty.totals.orderCount, 0);
assert.equal(empty.products.length, 0);
pass(
  "an empty historical day returns genuine zero totals and an empty ranking",
);
const anonymous = client();
const anonResult = await anonymous.rpc("get_daily_restaurant_report", {
  target_restaurant: r,
});
assert.equal(anonResult.error?.code, "42501");
pass("unauthenticated API callers cannot execute the report RPC");
await ok(anonymous.auth.signInAnonymously(), "Independent test guest");
const guestResult = await anonymous.rpc("get_daily_restaurant_report", {
  target_restaurant: r,
});
assert.equal(guestResult.error?.message, "STAFF_REQUIRED");
pass("authenticated anonymous guests cannot retrieve restaurant history");
const foreignResult = await staff.rpc("get_daily_restaurant_report", {
  target_restaurant: "a306f8e2-3c99-42f5-8ce2-cdb9d0ea34a2",
});
assert.equal(foreignResult.error?.message, "STAFF_FORBIDDEN");
pass("owner cannot read a separate restaurant without membership");
const legacyQa = await fetchDailyReport(
  staff,
  "b90c965f-78cd-4689-a7ba-db6b07163da4",
  { day: "2026-10-20" },
);
assert.equal(legacyQa.totals.orderCount, 6);
assert.equal(legacyQa.orders.length, 6);
pass(
  "closed, unpublished QA restaurant retains its real historical snapshots for its owner",
);
const invalid = await staff.rpc("get_daily_restaurant_report", {
  target_restaurant: r,
  report_day: "2026-10-20",
  before_order: legacyQa.orders[0].id,
});
assert.equal(invalid.error?.message, "REPORT_INVALID");
pass("cross-restaurant cursors are rejected without exposing records");
const report = {
  project,
  checks,
  daysVerified: days.length,
  existingOrdersInspected: existing.length,
  restaurantMutations: 0,
  browser: "not verified",
  physicalDevice: "not available",
  verifiedAt: new Date().toISOString(),
};
await writeFile(
  "/private/tmp/restaurant-os-daily-report-verification.json",
  JSON.stringify(report, null, 2),
  { mode: 0o600 },
);
console.log(
  `PASS ${checks.length} hosted checks; existing restaurant records were read only.`,
);
