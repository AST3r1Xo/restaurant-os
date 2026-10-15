import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
if (process.env.CONFIRM_MENU_ADMIN_QA !== "development")
  throw new Error("Explicit development QA confirmation required.");
const report = JSON.parse(
  await readFile(
    "/private/tmp/restaurant-os-menu-admin-verification.json",
    "utf8",
  ),
);
const client = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false } },
);
async function ok(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.code ?? "Verification failed");
  return data;
}
await ok(
  client.auth.signInWithPassword({
    email: process.env.STAFF_TEST_EMAIL,
    password: process.env.STAFF_TEST_PASSWORD,
  }),
);
const workspace = () =>
  ok(client.rpc("menu_workspace", { target_restaurant: report.restaurantId }));
const p = (await workspace()).products.find((p) => p.id === report.productId);
const definition = {
  name: p.name,
  description: p.description,
  category_id: p.category_id,
  price_minor: p.price_minor,
  ingredients: p.ingredients,
  allergens: p.allergens,
  dietary_tags: p.dietary_tags,
  is_available: false,
  status: "archived",
  keep_legacy_image: false,
  image_asset_id: p.image_asset_id,
  model_asset_id: p.model_asset_id,
  model_usdz_asset_id: p.model_usdz_asset_id,
  model_poster_asset_id: p.model_poster_asset_id,
  model_verified: false,
  model_ar_enabled: false,
  review: {
    license: "Draft CC0 rights note",
    provenance:
      "Development ingredient study — draft notes persisted before review.",
    measurement_notes:
      "Review remains incomplete. Customer 3D and AR stay disabled.",
    confirmed: false,
  },
  groups: p.groups,
};
await ok(
  client.rpc("save_menu_product", {
    target_restaurant: report.restaurantId,
    product_id: p.id,
    expected_version: p.updated_at,
    definition,
  }),
);
const saved = (await workspace()).products.find(
  (p) => p.id === report.productId,
);
assert.equal(saved.review.license, definition.review.license);
assert.equal(saved.model_verified, false);
assert.equal(saved.model_ar_enabled, false);
console.log(
  "PASS unverified source and measurement drafts persist in hosted PostgreSQL",
);
report.checks++;
const bad = await client.rpc("save_menu_product", {
  target_restaurant: report.restaurantId,
  product_id: p.id,
  expected_version: saved.updated_at,
  definition: {
    ...definition,
    model_verified: true,
    model_ar_enabled: true,
    review: { confirmed: true },
  },
});
assert.ok(bad.error);
assert.equal(bad.error.message, "MODEL_REVIEW_REQUIRED");
console.log("PASS incomplete model review cannot enable customer 3D or AR");
report.checks++;
report.verifiedAt = new Date().toISOString();
await writeFile(
  "/private/tmp/restaurant-os-menu-admin-verification.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
