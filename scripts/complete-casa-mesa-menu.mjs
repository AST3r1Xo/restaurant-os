import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { staffCookieOptions } from "../src/lib/supabase/staff-cookie.ts";
import { validateProduct } from "../src/features/menu-admin/validation.ts";
import { casaMesaRestaurant as restaurant, casaMesaProject, casaMesaAdditions } from "./data/casa-mesa-menu.mjs";

// One explicit development content operation. No privileged database client,
// destructive writes, new tenants, accounts, orders, or automatic seed execution.
const apply = process.argv.includes("--apply");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(new URL(url).hostname, casaMesaProject, "This catalog belongs to the Casa Mesa development project only.");
const origin = new URL(process.env.MENU_COMPLETION_ORIGIN ?? "http://127.0.0.1:3200");
assert.ok(!origin.username && !origin.password && origin.pathname === "/" && !origin.search && !origin.hash);
assert.ok(
  (origin.protocol === "http:" && ["127.0.0.1", "localhost"].includes(origin.hostname)) ||
  (origin.protocol === "https:" && origin.hostname === "restaurant-os-gamma-nine.vercel.app"),
  "Only the local app or its configured Casa Mesa HTTPS app may receive staff cookies.",
);
const jar = new Map();
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const client = createServerClient(url, key, {
  cookieOptions: staffCookieOptions(url),
  cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (items) => items.forEach(({ name, value }) => jar.set(name, value)),
  },
});
async function ok(promise, label) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label} failed (${error.code ?? "unavailable"}). No credentials are logged.`);
  return data;
}
async function workspace() {
  const data = await ok(client.rpc("menu_workspace", { target_restaurant: restaurant }), "Authorized menu workspace");
  assert.equal(data.restaurant.id, restaurant);
  assert.equal(data.restaurant.slug, "mesa");
  assert.equal(data.restaurant.currency, "EUR");
  return data;
}
async function snapshots() {
  const items = [];
  for (let start = 0; ; start += 500) {
    const page = await ok(client.from("order_items").select("*").eq("restaurant_id", restaurant).order("id").range(start, start + 499), "Historical snapshot verification");
    items.push(...page);
    if (page.length < 500) break;
  }
  return { count: items.length, hash: createHash("sha256").update(JSON.stringify(items)).digest("hex") };
}
async function save(item, version, definition) {
  return ok(client.rpc("save_menu_product", {
    target_restaurant: restaurant, product_id: item.id, expected_version: version, definition,
  }), `Save ${item.definition.name}`);
}
async function photoBytes(item) {
  const source = new URL(item.photo);
  assert.equal(source.protocol, "https:");
  assert.equal(source.hostname, "images.unsplash.com");
  const response = await fetch(source, { redirect: "error", signal: AbortSignal.timeout(30000) });
  if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== "image/jpeg")
    throw new Error(`Illustrative photograph unavailable for ${item.definition.name}.`);
  // Bound downloads before forwarding to the existing byte-validation gateway.
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > 4_000_000) throw new Error("Photograph exceeds the media limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function upload(item, bytes) {
  const response = await fetch(new URL("/api/admin/media", origin), {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(60000),
    headers: {
      origin: origin.origin,
      cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; "),
      "x-restaurant-id": restaurant, "x-product-id": item.id,
      "x-media-kind": "photo", "x-upload-id": item.uploadId,
      "x-file-name": "illustrative-menu-photo.jpg", "content-type": "image/jpeg",
    },
    body: bytes,
  });
  if (!response.ok) throw new Error(`Media upload failed for ${item.definition.name}. Its draft is retained for recovery in administration.`);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.asset.id, item.uploadId);
  assert.equal(result.asset.restaurant_id, restaurant);
  assert.equal(result.asset.product_id, item.id);
  assert.equal(result.asset.state, "ready");
  return result.asset.id;
}

await ok(client.auth.signInWithPassword({ email: process.env.STAFF_TEST_EMAIL?.trim(), password: process.env.STAFF_TEST_PASSWORD }), "Staff sign-in");
const { user } = await ok(client.auth.getUser(), "Verified staff identity");
assert.ok(user && !user.is_anonymous);
jar.set("restaurant-os-workspace", restaurant);
const before = await workspace();
for (const item of casaMesaAdditions) {
  validateProduct(item.definition);
  assert.ok(before.categories.some((c) => c.id === item.definition.category_id && c.is_active), "Expected published categories must exist.");
}
const existingNames = new Set(before.products.map((p) => p.name.trim().toLowerCase()));
const additions = casaMesaAdditions.filter((item) =>
  !before.products.some((p) => p.id === item.id) && !existingNames.has(item.definition.name.toLowerCase()),
);
console.log(`${apply ? "APPLY" : "PREVIEW"}: ${additions.length} new dishes; existing products are preserved.`);
if (!apply) {
  for (const item of additions) console.log(`${item.definition.name}: EUR ${(item.definition.price_minor / 100).toFixed(2)}`);
} else {
  const history = await snapshots();
  for (const item of additions) {
    const bytes = await photoBytes(item);
    await save(item, null, { ...item.definition, status: "draft", is_available: false });
    const draft = (await workspace()).products.find((p) => p.id === item.id);
    const image = await upload(item, bytes);
    await save(item, draft.updated_at, { ...item.definition, image_asset_id: image });
    console.log(`Published ${item.definition.name}`);
  }
  const after = await workspace();
  for (const p of before.products)
    assert.deepEqual(after.products.find((x) => x.id === p.id), p, "A pre-existing product changed; review concurrent edits.");
  assert.deepEqual(await snapshots(), history, "Historical order snapshots changed; inspect concurrent activity.");
  const publicClient = createClient(url, key, { auth: { persistSession: false } });
  const published = await ok(publicClient.from("products").select("id,name,image_url,category_id,price_minor").eq("restaurant_id", restaurant).eq("is_published", true).eq("is_available", true).is("archived_at", null), "Public live menu verification");
  for (const item of additions) {
    const p = published.find((p) => p.id === item.id);
    assert.equal(p?.price_minor, item.definition.price_minor);
    assert.ok(p.image_url?.includes(`/products/${item.id}/images/`));
  }
  console.log(`PASS: ${published.length} published dishes; ${history.count} historical item snapshots and all existing products preserved.`);
}
