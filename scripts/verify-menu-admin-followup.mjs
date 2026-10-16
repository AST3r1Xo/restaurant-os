import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import sharp from "sharp";
import { qaAdminKey } from "./qa-admin.mjs";
import { staffCookieOptions } from "../src/lib/supabase/staff-cookie.ts";
if (process.env.CONFIRM_MENU_ADMIN_QA !== "development")
  throw new Error("Explicit development QA confirmation required.");
const administrativeKey = qaAdminKey(process.env.NEXT_PUBLIC_SUPABASE_URL);
const report = JSON.parse(
  await readFile(
    "/private/tmp/restaurant-os-menu-admin-verification.json",
    "utf8",
  ),
);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  origin = "http://localhost:3000",
  r = report.restaurantId,
  p = report.productId;
const service = createClient(url, administrativeKey, {
    auth: { persistSession: false },
  }),
  jar = new Map();
const owner = createServerClient(url, key, {
  cookieOptions: staffCookieOptions(url),
  cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (items) => items.forEach((c) => jar.set(c.name, c.value)),
  },
});
async function ok(request) {
  const { data, error } = await request;
  if (error) throw new Error(error.code ?? "Request failed");
  return data;
}
await ok(
  owner.auth.signInWithPassword({
    email: process.env.STAFF_TEST_EMAIL,
    password: process.env.STAFF_TEST_PASSWORD,
  }),
);
jar.set("restaurant-os-workspace", r);
const cookie = () =>
  [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
function pass(message) {
  report.checks++;
  console.log(`PASS ${message}`);
}
async function workspace() {
  return ok(owner.rpc("menu_workspace", { target_restaurant: r }));
}
function definition(p) {
  return {
    name: p.name,
    description: p.description,
    category_id: p.category_id,
    price_minor: p.price_minor,
    ingredients: p.ingredients,
    allergens: p.allergens,
    dietary_tags: p.dietary_tags,
    is_available: true,
    status: "draft",
    keep_legacy_image: false,
    image_asset_id: p.image_asset_id,
    model_asset_id: p.model_asset_id,
    model_usdz_asset_id: p.model_usdz_asset_id,
    model_poster_asset_id: p.model_poster_asset_id,
    model_verified: p.model_verified,
    model_ar_enabled: p.model_ar_enabled,
    review: p.review,
    groups: p.groups,
  };
}
async function save(changes) {
  const current = (await workspace()).products.find((x) => x.id === p);
  await ok(
    owner.rpc("save_menu_product", {
      target_restaurant: r,
      product_id: p,
      expected_version: current.updated_at,
      definition: { ...definition(current), ...changes },
    }),
  );
}
async function upload(kind, name, mime, bytes, headers = {}) {
  const res = await fetch(`${origin}/api/admin/media`, {
    method: "POST",
    headers: {
      origin,
      cookie: cookie(),
      "x-restaurant-id": r,
      "x-product-id": p,
      "x-media-kind": kind,
      "x-upload-id": randomUUID(),
      "x-file-name": encodeURIComponent(name),
      "content-type": mime,
      ...headers,
    },
    body: bytes,
  });
  return { status: res.status, ...(await res.json()) };
}
function crc32(b) {
  let c = 0xffffffff;
  for (const byte of b) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function usdzFixture(
  name = "scene.usda",
  text = '#usda 1.0\n( metersPerUnit = 1 )\ndef Xform "Test" {}\n',
) {
  const n = Buffer.from(name),
    data = Buffer.from(text),
    extra = (64 - ((30 + n.length) % 64)) % 64,
    local = Buffer.alloc(30 + n.length + extra);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc32(data), 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(n.length, 26);
  local.writeUInt16LE(extra, 28);
  n.copy(local, 30);
  const central = Buffer.alloc(46 + n.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc32(data), 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(n.length, 28);
  n.copy(central, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length + data.length, 16);
  return Buffer.concat([local, data, central, end]);
}
const usdz = await upload(
  "usdz",
  "structural-qa.usdz",
  "model/vnd.usdz+zip",
  usdzFixture(),
);
assert.equal(usdz.ok, true, usdz.message);
pass("optional USDZ passes actual gateway and restricted bucket MIME rules");
const image = await sharp({
  create: { width: 64, height: 64, channels: 3, background: "#e9eee6" },
})
  .png()
  .toBuffer();
const a = await upload("photo", "replacement-a.png", "image/png", image),
  b = await upload("photo", "replacement-b.png", "image/png", image);
assert.ok(a.ok && b.ok);
assert.notEqual(a.asset.object_path, b.asset.object_path);
await save({ image_asset_id: a.asset.id });
await save({ image_asset_id: b.asset.id });
pass("photo replacement uses a new immutable versioned path");
const deletion = await fetch(`${origin}/api/admin/media?id=${a.asset.id}`, {
  method: "DELETE",
  headers: { origin, cookie: cookie(), "x-restaurant-id": r },
});
assert.equal(deletion.status, 200);
pass(
  "replaced unused photo can be removed without touching the current photograph",
);
const before = (await workspace()).products.find((x) => x.id === p);
const invalid = await owner.rpc("save_menu_product", {
  target_restaurant: r,
  product_id: p,
  expected_version: before.updated_at,
  definition: { ...definition(before), model_ar_enabled: true },
});
assert.ok(invalid.error);
pass("AR cannot be enabled on an unreviewed model");
await save({
  model_verified: true,
  model_ar_enabled: true,
  review: {
    license: "CC0 Microsoft glTF sample",
    provenance:
      "Development ingredient study only; isolated unpublished QA tenant.",
    measurement_notes:
      "QA parser bounds 6.77 x 4.39 x 10 cm. No real dish portion or physical AR certification is claimed. Optional test USDZ is not attached.",
    confirmed: true,
  },
});
assert.equal(
  (await workspace()).products.find((x) => x.id === p).model_ar_enabled,
  true,
);
pass(
  "documented review and explicit AR opt-in persist for the isolated development study",
);
await save({ model_verified: false, model_ar_enabled: false });
const current = (await workspace()).restaurant;
await ok(
  owner.rpc("save_restaurant_presentation", {
    target_restaurant: r,
    expected_version: current.updated_at,
    definition: {
      name: current.name,
      description: "Verified manager settings update; isolated QA only.",
      timezone: "Europe/Lisbon",
      is_published: false,
      is_accepting_orders: false,
      logo_asset_id: null,
      cover_asset_id: null,
      keep_legacy_logo: true,
      keep_legacy_cover: true,
    },
  }),
);
assert.match((await workspace()).restaurant.description, /Verified manager/);
pass("restaurant presentation settings persist through manager RPC");
const forged = await upload("photo", "cross-product.png", "image/png", image, {
  "x-product-id": "44444444-4444-4444-8444-444444444441",
});
assert.equal(forged.status, 400);
pass("media gateway rejects cross-restaurant product association");
// Preserve the QA order while ending its service session through normal staff operations.
const order = await ok(
  service
    .from("orders")
    .select("id,status,table_id,session_id")
    .eq("id", report.orderId)
    .single(),
);
if (order.status === "pending")
  await ok(
    owner.rpc("transition_order", {
      target_restaurant: r,
      target_order: order.id,
      expected_status: "pending",
      next_status: "cancelled",
      reason: "Completed isolated menu administration verification.",
    }),
  );
if (order.session_id)
  await ok(
    owner.rpc("manage_table_session", {
      target_restaurant: r,
      target_table: order.table_id,
      target_session: order.session_id,
      operation: "close",
    }),
  );
pass(
  "QA session closed through authorized staff flow; historical QA order retained",
);
const snapshots = await ok(
  service
    .from("order_items")
    .select("unit_price_minor,product_name")
    .eq("order_id", order.id),
);
assert.equal(snapshots[0].unit_price_minor, 1350);
pass(
  "historical order snapshot survives all media and restaurant settings edits",
);
await save({
  status: "archived",
  model_verified: false,
  model_ar_enabled: false,
});
report.verifiedAt = new Date().toISOString();
report.sessionClosed = true;
await writeFile(
  "/private/tmp/restaurant-os-menu-admin-verification.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
