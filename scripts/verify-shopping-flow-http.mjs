import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

// HTTP route/navigation verification only. No DOM interaction, localStorage
// hydration or physical-phone validation is claimed. Restaurant data is read-only.
const origin = new URL(
  process.env.SHOPPING_TEST_ORIGIN ?? "http://127.0.0.1:3400",
);
assert.ok(["localhost", "127.0.0.1"].includes(origin.hostname));
assert.equal(origin.username, "");
assert.equal(origin.password, "");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(new URL(url).hostname, "ahkleoidhzcsubsdlqbn.supabase.co");
const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
const auth = await c.auth.signInWithPassword({
  email: process.env.STAFF_TEST_EMAIL.trim(),
  password: process.env.STAFF_TEST_PASSWORD,
});
if (auth.error)
  throw new Error(
    `Staff sign-in failed (${auth.error.code}); credentials withheld`,
  );
const { data: identity, error: identityError } = await c.auth.getUser();
assert.ok(!identityError && identity.user && !identity.user.is_anonymous);
const { data: tables, error } = await c.rpc("get_table_qr_codes", {
  target_restaurant: "11111111-1111-4111-8111-111111111111",
});
if (error)
  throw new Error(`Authorized QR read failed (${error.code}); tokens withheld`);
const token = tables.find((t) => t.is_active)?.qr_token;
assert.ok(token);
async function request(path) {
  const response = await fetch(new URL(path, origin), {
    redirect: "manual",
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(20000),
  });
  return { response, html: await response.text() };
}
async function redirect(path, expected) {
  const { response, html } = await request(path);
  if ([303, 307, 308].includes(response.status)) {
    const destination = new URL(response.headers.get("location"), origin);
    assert.ok(
      destination.origin === origin.origin &&
        destination.pathname + destination.search === expected,
      "Review redirects only to the intended same-origin bag",
    );
  } else {
    // App Router may have started its public loading stream before redirect().
    assert.equal(response.status, 200);
    assert.ok(
      html.includes("NEXT_REDIRECT") && html.includes(expected),
      "Streamed redirect retains the correct bag destination",
    );
  }
}
await redirect(`/r/mesa/review?table=${token}`, `/r/mesa/cart?table=${token}`);
console.log(
  "PASS legacy review links resolve the QR server-side and go directly to the same table's bag",
);
await redirect("/r/mesa/review", "/r/mesa/cart");
await redirect("/r/mesa/review?table=invalid", "/r/mesa/cart");
console.log(
  "PASS absent/invalid QR context cannot be carried forward as a validated table",
);
const cart = await request(`/r/mesa/cart?table=${token}`);
assert.equal(cart.response.status, 200);
assert.match(cart.response.headers.get("cache-control"), /no-store/);
assert.ok(cart.html.includes("Sent orders"));
console.log(
  "PASS the live bag route and Sent orders navigation render without a second review destination",
);
const search = await request("/r/mesa?q=cheesecake");
assert.equal(search.response.status, 200);
const rendered = (html) =>
  html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
const decode = (text) =>
  text.replaceAll("&amp;", "&").replaceAll("&quot;", '"');
const link = rendered(search.html).match(
  /<a\b([^>]*aria-label="Choose [^"]+"[^>]*)>/,
);
assert.ok(link);
const href = decode(link[1].match(/href="([^"]+)"/)[1]);
const dish = await request(href);
assert.equal(dish.response.status, 200);
const html = rendered(dish.html);
assert.match(html, /Adding to your bag does not send an order/);
assert.match(html, /Add to bag/);
assert.match(html, /Special request/);
assert.ok(
  html.includes("q=cheesecake"),
  "Returning from the product retains search context",
);
console.log(
  "PASS live product copy distinguishes adding from sending and retains menu search context",
);
const denied = await request(
  "/r/mesa/orders/10000000-0000-4000-8000-000000000001",
);
assert.equal(denied.response.status, 404);
assert.ok(
  !rendered(denied.html).includes("Your order is saved with the restaurant"),
);
console.log(
  "PASS an unowned receipt URL cannot show the new reassuring success controls",
);
console.log(
  "PASS five HTTP navigation scenarios; no guest orders, sessions or menu records were created or edited.",
);
