import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import sharp from "sharp";
import { qaAdminKey } from "./qa-admin.mjs";
import { staffCookieOptions } from "../src/lib/supabase/staff-cookie.ts";
// Explicit development-only integration test. Creates an isolated QA tenant,
// confirmed QA staff accounts and one real QA order; preserves all records.
if (process.env.CONFIRM_MENU_ADMIN_QA !== "development")
  throw new Error(
    "Set CONFIRM_MENU_ADMIN_QA=development to authorize isolated QA fixtures.",
  );
const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const origin = process.env.MENU_ADMIN_TEST_ORIGIN ?? "http://localhost:3000";
const service = createClient(url, qaAdminKey(url), {
  auth: { persistSession: false },
});
const client = () =>
  createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
async function ok(promise, label) {
  const result = await promise;
  if (result.error)
    throw new Error(
      `${label}: ${result.error.code ?? result.error.status ?? "failed"} ${result.error.message?.replace(/eyJ\S+/g, "[redacted]")}`,
    );
  return result.data;
}
let checks = 0;
function pass(label) {
  checks++;
  console.log(`PASS ${label}`);
}
async function denied(promise, label) {
  const { error, data } = await promise;
  assert.ok(error || !data || data.length === 0, label);
  pass(label);
}
const cookieJar = new Map();
const owner = createServerClient(url, key, {
  cookieOptions: staffCookieOptions(url),
  cookies: {
    getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
    setAll: (items) => items.forEach((c) => cookieJar.set(c.name, c.value)),
  },
});
await ok(
  owner.auth.signInWithPassword({
    email: process.env.STAFF_TEST_EMAIL,
    password: process.env.STAFF_TEST_PASSWORD,
  }),
  "Owner authentication",
);
const actor = (await ok(owner.auth.getUser(), "Verified owner")).user;
const r = randomUUID(),
  category = randomUUID(),
  product = randomUUID(),
  table = randomUUID(),
  slug = `menu-admin-qa-${r.slice(0, 8)}`;
await ok(
  service.from("restaurants").insert({
    id: r,
    slug,
    name: "Menu administration QA",
    description: "Isolated development verification — not a real restaurant",
    is_published: true,
    is_accepting_orders: true,
  }),
  "QA restaurant",
);
await ok(
  service
    .from("restaurant_members")
    .insert({ restaurant_id: r, user_id: actor.id, role: "owner" }),
  "QA owner",
);
cookieJar.set("restaurant-os-workspace", r);
const identities = { owner };
for (const role of ["manager", "staff", "outsider"]) {
  const password = randomBytes(32).toString("base64url"),
    email = `menu-${role}-${r.slice(0, 8)}@example.test`;
  const { user } = await ok(
    service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { development_qa: true },
    }),
    "QA staff provisioning",
  );
  if (role !== "outsider")
    await ok(
      service
        .from("restaurant_members")
        .insert({ restaurant_id: r, user_id: user.id, role }),
      "QA membership",
    );
  const signed = client();
  await ok(signed.auth.signInWithPassword({ email, password }), "QA sign-in");
  identities[role] = signed;
}
const guest = client();
await ok(guest.auth.signInAnonymously(), "QA anonymous guest");
const workspace = async (c = owner) =>
  await ok(c.rpc("menu_workspace", { target_restaurant: r }), "Workspace");
await ok(
  owner.rpc("save_menu_category", {
    target_restaurant: r,
    category_id: category,
    expected_version: null,
    definition: {
      name: "QA dishes",
      description: "Isolated tests",
      is_active: true,
    },
  }),
  "Category creation",
);
const group = randomUUID(),
  option = randomUUID();
let definition = {
  name: "QA development ingredient study",
  description: "Explicit test asset; not an actual restaurant dish",
  category_id: category,
  price_minor: 1250,
  ingredients: ["Avocado"],
  allergens: [],
  dietary_tags: [],
  is_available: true,
  status: "draft",
  keep_legacy_image: false,
  image_asset_id: null,
  model_asset_id: null,
  model_usdz_asset_id: null,
  model_poster_asset_id: null,
  model_verified: false,
  model_ar_enabled: false,
  review: {
    confirmed: false,
    license: "",
    provenance: "",
    measurement_notes: "",
  },
  groups: [
    {
      id: group,
      name: "QA choice",
      description: "",
      selection_type: "single",
      min_selections: 1,
      max_selections: 1,
      is_active: true,
      options: [
        {
          id: option,
          name: "QA supplement",
          price_adjustment_minor: 50,
          is_available: true,
        },
      ],
    },
  ],
};
async function save(changes = {}, c = owner) {
  const current = (await workspace()).products.find((p) => p.id === product);
  definition = { ...definition, ...changes };
  await ok(
    c.rpc("save_menu_product", {
      target_restaurant: r,
      product_id: product,
      expected_version: current?.updated_at ?? null,
      definition,
    }),
    "Product save",
  );
  return (await workspace()).products.find((p) => p.id === product);
}
await save();
pass("owner creates actual draft product with required modifier");
await denied(
  client().from("products").select("id").eq("id", product),
  "draft hidden from anonymous menu",
);
await save({ price_minor: 1300 }, identities.manager);
pass("manager edits price");
for (const role of ["staff", "outsider"])
  await denied(
    identities[role].rpc("menu_workspace", { target_restaurant: r }),
    `${role} cannot edit restaurant`,
  );
await denied(
  guest.rpc("menu_workspace", { target_restaurant: r }),
  "anonymous guest cannot edit",
);
await denied(
  owner.rpc("menu_workspace", {
    target_restaurant: "77777777-7777-4777-8777-777777777770",
  }),
  "cross-restaurant editor denied",
);
await denied(
  owner
    .from("products")
    .update({ price_minor: 1 })
    .eq("id", product)
    .select("id"),
  "direct catalog write cannot bypass RPC",
);
const cookie = () =>
  [...cookieJar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
async function upload(
  kind,
  name,
  contentType,
  bytes,
  id = randomUUID(),
  cookies = cookie(),
  extra = {},
) {
  const response = await fetch(`${origin}/api/admin/media`, {
    method: "POST",
    headers: {
      origin,
      "x-restaurant-id": r,
      "x-product-id": product,
      "x-media-kind": kind,
      "x-upload-id": id,
      "x-file-name": encodeURIComponent(name),
      "content-type": contentType,
      cookie: cookies,
      ...extra,
    },
    body: bytes,
  });
  return { response, result: await response.json() };
}
const image = await sharp({
  create: { width: 1000, height: 600, channels: 3, background: "#314d3b" },
})
  .png()
  .toBuffer();
let invalid = await upload(
  "photo",
  "fake.png",
  "image/png",
  Buffer.from("not an image"),
);
assert.equal(invalid.response.status, 400);
pass("spoofed image rejected by authenticated upload gateway");
invalid = await upload(
  "photo",
  "dish.png",
  "image/png",
  image,
  randomUUID(),
  "",
);
assert.equal(invalid.response.status, 400);
pass("unauthenticated media gateway rejected");
const imageId = randomUUID(),
  photo = await upload("photo", "qa.png", "image/png", image, imageId);
assert.equal(photo.result.ok, true, photo.result.message);
assert.equal(photo.result.asset.content_type, "image/webp");
pass("real photo decoded, optimized and uploaded to Storage");
const retry = await upload("photo", "qa.png", "image/png", image, imageId);
assert.equal(retry.result.asset.id, imageId);
pass("same upload UUID recovers existing validated file");
const bytes = await readFile("public/models/demo-mesa/eggs/avocado.glb"),
  model = await upload(
    "glb",
    "development-avocado.glb",
    "model/gltf-binary",
    bytes,
  );
assert.equal(model.result.ok, true, model.result.message);
assert.ok(model.result.asset.dimensions_m[0] > 0.06);
pass("genuine GLB validated, physically measured and stored");
const poster = await upload("poster", "poster.png", "image/png", image);
assert.equal(poster.result.ok, true);
await save({
  image_asset_id: photo.result.asset.id,
  model_asset_id: model.result.asset.id,
  model_poster_asset_id: poster.result.asset.id,
  status: "published",
});
pass("photo and unreviewed model attached using ready asset IDs");
const pub = client(),
  visible = await ok(
    pub
      .from("products")
      .select("id,price_minor,image_url,model_verified")
      .eq("id", product),
    "Published customer menu",
  );
assert.equal(visible.length, 1);
assert.equal(visible[0].model_verified, false);
pass("published changes visible; unreviewed model remains disabled");
const direct = await owner.storage
  .from("restaurant-media")
  .upload(`restaurants/${r}/products/${product}/images/bypass.webp`, image, {
    contentType: "image/webp",
  });
assert.ok(direct.error);
pass("owner JWT cannot bypass binary validation through direct Storage API");
const publicFile = await fetch(photo.result.asset.public_url);
assert.equal(publicFile.status, 200);
assert.equal(
  publicFile.headers.get("content-type")?.split(";")[0],
  "image/webp",
);
pass("validated public photograph is readable");
const referenced = await fetch(
  `${origin}/api/admin/media?id=${photo.result.asset.id}`,
  {
    method: "DELETE",
    headers: { origin, cookie: cookie(), "x-restaurant-id": r },
  },
);
assert.equal(referenced.status, 400);
pass("referenced media cannot be deleted");
// A real guest order proves edited prices still pass the trusted checkout path.
await ok(
  service
    .from("dining_tables")
    .insert({ id: table, restaurant_id: r, label: "QA only" }),
  "QA table",
);
const qr = (
  await ok(
    service.from("dining_tables").select("qr_token").eq("id", table).single(),
    "QA QR",
  )
).qr_token;
const visit = (
  await ok(
    guest.rpc("resolve_table_visit", {
      restaurant_slug: slug,
      table_token: qr,
    }),
    "Resolve QA table",
  )
)[0].visit_key;
const items = [{ productId: product, quantity: 2, optionIds: [option] }];
const review = await ok(
  guest.rpc("review_visit_order", {
    restaurant_slug: slug,
    table_token: qr,
    items,
    visit_key: visit,
  }),
  "Guest review",
);
// Signature is kept in sync with generated types; no client financial authority.
const args = {
  restaurant_slug: slug,
  table_token: qr,
  items,
  idempotency_key: randomUUID(),
  review_id: review.reviewId,
};
const order = await ok(
  guest.rpc("create_guest_order", args),
  "Create real QA order",
);
assert.equal(order.totalMinor, 2700);
pass("real customized order uses updated trusted product and modifier prices");
await save({ price_minor: 1900, name: "QA edited after order" });
const snapshots = await ok(
  service
    .from("order_items")
    .select("product_name,unit_price_minor,quantity")
    .eq("order_id", order.id),
  "Historical snapshots",
);
assert.equal(snapshots[0].unit_price_minor, 1350);
assert.equal(snapshots[0].quantity, 2);
assert.equal(snapshots[0].product_name, "QA development ingredient study");
pass("historical name, price and quantity unchanged after manager edit");
const stale = await ok(
  guest.rpc("review_visit_order", {
    restaurant_slug: slug,
    table_token: qr,
    items,
    visit_key: visit,
  }),
  "Fresh QA review",
);
await save({ price_minor: 2000 });
await denied(
  guest.rpc("create_guest_order", {
    ...args,
    idempotency_key: randomUUID(),
    review_id: stale.reviewId,
  }),
  "outdated reviewed cart cannot silently confirm changed prices",
);
const oldImage = photo.result.asset;
await save({ image_asset_id: null, status: "archived" });
const removal = await fetch(`${origin}/api/admin/media?id=${oldImage.id}`, {
  method: "DELETE",
  headers: { origin, cookie: cookie(), "x-restaurant-id": r },
});
assert.equal(removal.status, 200);
pass("explicit removal of unused asset uses supported Storage API");
await denied(
  pub.from("products").select("id").eq("id", product),
  "archived product hidden from customer menu",
);
// QA records stay isolated and retained, with the QA restaurant unpublished.
const rr = (await workspace()).restaurant;
await ok(
  owner.rpc("save_restaurant_presentation", {
    target_restaurant: r,
    expected_version: rr.updated_at,
    definition: {
      name: rr.name,
      description: rr.description,
      timezone: rr.timezone,
      is_published: false,
      is_accepting_orders: false,
      logo_asset_id: null,
      cover_asset_id: null,
      keep_legacy_logo: true,
      keep_legacy_cover: true,
    },
  }),
  "Finish isolated QA",
);
const report = {
  verifiedAt: new Date().toISOString(),
  checks,
  restaurantId: r,
  slug,
  productId: product,
  orderId: order.id,
  isolated: true,
  restaurantUnpublished: true,
};
await writeFile(
  "/private/tmp/restaurant-os-menu-admin-verification.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
