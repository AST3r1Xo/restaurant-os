import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

// HTTP/SSR checks only: user-agent headers do not emulate a viewport, touch,
// hydration, device performance, accessibility technology or physical AR.
const origin = process.env.HTTP_SMOKE_ORIGIN ?? "http://127.0.0.1:3400";
const base = new URL(origin);
assert.ok(base.protocol === "https:" || ["localhost", "127.0.0.1"].includes(base.hostname));
const slug = process.env.HTTP_SMOKE_RESTAURANT ?? "mesa";
assert.match(slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
const agents = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 15; 2406APNFAG) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36",
  desktop: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
};
const checks = [];
let requests = 0;
function pass(label) { checks.push(label); console.log(`PASS ${label}`); }
const decode = s => s.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#x27;", "'");
const rendered = html => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
async function get(path, agent, expected = 200) {
  requests++;
  const response = await fetch(new URL(path, base), { redirect: "manual", headers: { "User-Agent": agent, "Cache-Control": "no-cache" }, signal: AbortSignal.timeout(20000) });
  assert.ok([expected].flat().includes(response.status), `${path}: unexpected HTTP ${response.status}`);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  return { response, html: rendered(await response.text()) };
}
for (const [name, agent] of Object.entries(agents)) {
  const { html } = await get(`/r/${slug}`, agent);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/);
  assert.match(html, /aria-label="Menu categories"/);
  const dishes = [...html.matchAll(/<a\b([^>]*aria-label="Choose [^"]+"[^>]*)>/g)].map(m => decode(m[1].match(/href="([^"]+)"/)[1]));
  assert.ok(dishes.length > 0); assert.equal(new Set(dishes).size, dishes.length);
  pass(`${name}: public menu has unique product links, category controls and viewport metadata`);
  const detail = await get(dishes[0], agent);
  assert.match(detail.html, /Special request/); assert.match(detail.html, /maxLength="300"/i); assert.match(detail.html, /Add to bag/);
  pass(`${name}: linked product renders customization and bounded special requests`);
  const empty = await get(`/r/${slug}?q=qa-no-such-dish-823947`, agent);
  assert.match(empty.html, /No dishes found/); assert.match(empty.html, /Show all dishes/);
  pass(`${name}: empty search has a recovery action`);
  const injection = await get(`/r/${slug}?q=${encodeURIComponent('<script>window.qaInjection=1</script>')}`, agent);
  assert.ok(!injection.html.includes("<script>window.qaInjection=1</script>"));
  pass(`${name}: search text cannot introduce executable HTML`);
  for (const route of ["cart", "review", "orders", "bill"]) await get(`/r/${slug}/${route}`, agent);
  pass(`${name}: bag, review, current orders and bill return non-cacheable responses`);
  await get(`/r/${slug}/orders/10000000-0000-4000-8000-000000000001`, agent, 404);
  // Public product loading may start streaming before notFound(). Next retains
  // HTTP 200 in that case; private receipts must still return a real 404 above.
  const missing = await get(`/r/${slug}/products/10000000-0000-4000-8000-000000000002`, agent, [200, 404]);
  assert.match(missing.html, /Dish unavailable/); assert.match(missing.html, /noindex/);
  await get("/r/qa-missing-restaurant-823947", agent, 404);
  pass(`${name}: private receipt and missing restaurant/product fail without exposing records`);
}
for (const path of ["/admin", "/admin/orders", "/admin/tables", "/admin/menu", "/admin/settings"]) {
  const { response } = await get(path, agents.desktop, 307);
  const location = new URL(response.headers.get("location"), base);
  assert.equal(location.origin, base.origin); assert.equal(location.pathname, "/admin/login");
}
pass("all five private staff pages redirect unauthenticated requests to same-origin login");
const qr = await get("/api/admin/table-qr?restaurant=11111111-1111-4111-8111-111111111111&format=zip", agents.desktop, 403);
assert.ok(!qr.html.includes("qr_token"));
pass("private QR downloads reject unauthenticated access and expose no table tokens");
for (const method of ["POST", "DELETE"]) {
  requests++;
  const response = await fetch(new URL("/api/admin/media", base), { method, headers: { Origin: base.origin, "X-Restaurant-Id": "11111111-1111-4111-8111-111111111111", "Content-Type": "application/octet-stream" }, ...(method === "POST" ? { body: "inert unauthenticated QA bytes" } : {}), signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).ok, false); assert.match(response.headers.get("cache-control"), /no-store/);
}
pass("unauthenticated media upload/deletion are rejected before any storage mutation");
const report = { origin: base.origin, checks, requests, kind: "HTTP/SSR only; no interactive browser or physical device verification", verifiedAt: new Date().toISOString() };
if (process.env.HTTP_SMOKE_REPORT) await writeFile(process.env.HTTP_SMOKE_REPORT, JSON.stringify(report, null, 2));
console.log(`PASS ${checks.length} HTTP/SSR scenarios, ${requests} requests.`);
