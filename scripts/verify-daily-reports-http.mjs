import assert from "node:assert/strict";
import { createServerClient } from "@supabase/ssr";
import { staffCookieOptions } from "../src/lib/supabase/staff-cookie.ts";

// Authenticated SSR/HTTP checks, NOT interactive browser or device emulation.
// Keep the credential-bearing cookie header inside this local process only.
const origin = new URL(
  process.env.REPORT_TEST_ORIGIN ?? "http://127.0.0.1:3400",
);
assert.ok(["127.0.0.1", "localhost"].includes(origin.hostname));
assert.equal(origin.username, "");
assert.equal(origin.password, "");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(new URL(url).hostname, "ahkleoidhzcsubsdlqbn.supabase.co");
const jar = new Map();
const c = createServerClient(
  url,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  {
    cookieOptions: staffCookieOptions(url),
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (rows) => rows.forEach((row) => jar.set(row.name, row.value)),
    },
  },
);
const signIn = await c.auth.signInWithPassword({
  email: process.env.STAFF_TEST_EMAIL.trim(),
  password: process.env.STAFF_TEST_PASSWORD,
});
if (signIn.error)
  throw new Error(
    `Staff sign-in failed (${signIn.error.code}); credentials withheld`,
  );
const verified = await c.auth.getUser();
assert.ok(verified.data.user && !verified.data.user.is_anonymous);
const cookie =
  [...jar]
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join("; ") +
  "; restaurant-os-workspace=11111111-1111-4111-8111-111111111111";
const render = async (path, authenticated = true) => {
  const response = await fetch(new URL(path, origin), {
    redirect: "manual",
    headers: {
      ...(authenticated ? { Cookie: cookie } : {}),
      "Cache-Control": "no-cache",
    },
    signal: AbortSignal.timeout(30000),
  });
  const html = (await response.text()).replace(
    /<script\b[^>]*>[\s\S]*?<\/script>/g,
    "",
  );
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  return { response, html };
};
const today = await render("/admin/history");
assert.equal(today.response.status, 200);
for (const text of [
  "Your day, at a glance",
  "Confirmed order value",
  "Most ordered dishes",
  "Less ordered",
  "Orders from this day",
  "Daily history",
])
  assert.ok(today.html.includes(text));
assert.match(today.html, /type="date"/);
console.log(
  "PASS authenticated production SSR renders the new dashboard, date picker and owner navigation",
);
const empty = await render("/admin/history?date=2000-01-01");
assert.equal(empty.response.status, 200);
assert.match(empty.html, /No orders recorded for this day/);
assert.match(empty.html, /No confirmed dishes/);
console.log(
  "PASS empty-day SSR renders honest empty metrics/ranking and date recovery",
);
const earliest = await c
  .from("orders")
  .select("created_at")
  .eq("restaurant_id", "11111111-1111-4111-8111-111111111111")
  .order("created_at")
  .limit(1);
assert.ok(!earliest.error && earliest.data.length === 1);
const day = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Lisbon",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date(earliest.data[0].created_at));
const stored = await c.rpc("get_daily_restaurant_report", {
  target_restaurant: "11111111-1111-4111-8111-111111111111",
  report_day: day,
});
assert.ok(!stored.error && stored.data.orders.length > 0);
const history = await render(`/admin/history?date=${day}`);
assert.equal(history.response.status, 200);
assert.ok(history.html.includes(stored.data.orders[0].reference));
assert.match(history.html, /<details/);
console.log(
  "PASS an actual historical day renders original receipt references and expandable details",
);
const invalid = await render("/admin/history?date=2026-02-30");
assert.equal(invalid.response.status, 200);
assert.match(invalid.html, /Choose a reporting day/);
assert.match(invalid.html, /View today/);
console.log(
  "PASS malformed date shows an actionable validation state without a database error",
);
const denied = await render("/admin/history", false);
assert.equal(denied.response.status, 307);
assert.equal(
  new URL(denied.response.headers.get("location"), origin).pathname,
  "/admin/login",
);
assert.ok(!denied.html.includes("Confirmed order value"));
console.log(
  "PASS unauthenticated HTTP cannot render report data and redirects to staff login",
);
console.log(
  "PASS five production HTTP/SSR checks. Cookies were kept in memory and no restaurant data was changed.",
);
