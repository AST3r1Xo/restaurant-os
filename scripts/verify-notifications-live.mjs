import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { fetchGuestActivity } from "../src/features/notifications/repository.ts";
import { staffNotices } from "../src/features/notifications/model.ts";
import { fetchWorkspace } from "../src/features/sessions/repository.ts";
import { verifiedGuest } from "../src/features/orders/guest-auth.ts";

// Ordinary staff/guest authorization only. Never use the media service key.
assert.equal(
  process.env.CONFIRM_NOTIFICATION_QA,
  "development",
  "Explicit development QA acknowledgement is required",
);
const project = "ahkleoidhzcsubsdlqbn";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(new URL(url).hostname, `${project}.supabase.co`);
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
assert.ok(
  key && process.env.STAFF_TEST_EMAIL && process.env.STAFF_TEST_PASSWORD,
  "Local test configuration is required; values withheld",
);
const create = () =>
  createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
const staff = create();
const login = await staff.auth.signInWithPassword({
  email: process.env.STAFF_TEST_EMAIL.trim(),
  password: process.env.STAFF_TEST_PASSWORD,
});
assert.ok(!login.error, "Staff sign-in failed; credentials withheld");
const identity = await staff.auth.getUser();
assert.ok(
  !identity.error && identity.data.user && !identity.data.user.is_anonymous,
  "Staff identity must be remotely verified",
);
const restaurantId = "11111111-1111-4111-8111-111111111111";
const qr = await staff.rpc("get_table_qr_codes", {
  target_restaurant: restaurantId,
});
assert.ok(
  !qr.error && qr.data?.length,
  "Authorized QR read failed; no tokens logged",
);
const table = qr.data.find((t) => t.is_active);
assert.ok(
  table,
  "A configured active table is required for read-only validation",
);
const guest = create();
const anonymous = await guest.auth.signInAnonymously();
assert.ok(!anonymous.error, "Development anonymous Auth is unavailable");
const owner = await verifiedGuest(guest, false);
const resolved = await guest.rpc("resolve_table_visit", {
  restaurant_slug: "mesa",
  table_token: table.qr_token,
});
assert.ok(!resolved.error && resolved.data?.length === 1);
const input = {
  slug: "mesa",
  restaurantId,
  tableToken: table.qr_token,
  visitKey: resolved.data[0].visit_key,
};
const empty = await fetchGuestActivity(guest, owner.id, input);
assert.equal(empty.visitId, null);
assert.deepEqual(empty.orders, []);
assert.equal(empty.request, null);
const raw = await guest
  .from("orders")
  .select("id,status,created_at,updated_at")
  .eq("restaurant_id", restaurantId);
assert.ok(!raw.error);
assert.deepEqual(raw.data, []);
const requests = await guest
  .from("bill_requests")
  .select("id,status")
  .eq("restaurant_id", restaurantId);
assert.ok(!requests.error);
assert.deepEqual(requests.data, []);
const invalid = await fetchGuestActivity(guest, owner.id, {
  ...input,
  tableToken: crypto.randomUUID(),
});
assert.equal(invalid.visitId, null);
assert.deepEqual(invalid.orders, []);
const stale = await fetchGuestActivity(guest, owner.id, {
  ...input,
  visitKey: crypto.randomUUID(),
});
assert.equal(stale.visitId, null);
assert.deepEqual(stale.orders, []);
const workspace = await fetchWorkspace(staff, restaurantId);
assert.equal(workspace.restaurantId, restaurantId);
const notices = staffNotices(workspace);
assert.ok(
  notices.every((n) =>
    ["/admin", "/admin/tables#bill-requests"].includes(n.href),
  ),
);
assert.equal(new Set(notices.map((n) => n.id)).size, notices.length);
const unknown = await staff.rpc("get_table_workspace", {
  target_restaurant: crypto.randomUUID(),
});
assert.ok(unknown.error, "Unrelated restaurant access must be denied");
console.log(
  JSON.stringify({
    project,
    checks: 8,
    passed: true,
    staffNotices: notices.length,
    guestOrdersExposed: 0,
    guestBillRequestsExposed: 0,
    restaurantMutations: 0,
    anonymousQAIdentityCreated: true,
    realtimeEventDeliveryTested: false,
  }),
);
