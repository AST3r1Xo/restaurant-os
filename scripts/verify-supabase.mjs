import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// Read-only setup check. Never print keys, Auth sessions, or raw API responses.
nextEnv.loadEnvConfig(process.cwd(), true);

function configuration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) {
    throw new Error(
      "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local before running this check.",
    );
  }
  const parsed = new URL(url);
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("The Supabase URL must use HTTP(S).");
  }
  let role;
  if (key.startsWith("eyJ")) {
    try {
      role = JSON.parse(
        Buffer.from(key.split(".")[1], "base64url").toString(),
      ).role;
    } catch {
      throw new Error("The public API key has an invalid JWT format.");
    }
  }
  if (key.startsWith("sb_secret_") || (role && role !== "anon")) {
    throw new Error(
      "A privileged key must never be used in NEXT_PUBLIC_* variables. Configure a publishable or legacy anon key instead.",
    );
  }
  const expectedProject = process.argv
    .find((argument) => argument.startsWith("--project-ref="))
    ?.slice("--project-ref=".length);
  if (expectedProject && parsed.hostname !== `${expectedProject}.supabase.co`) {
    throw new Error(
      "The configured URL does not match the expected Supabase project.",
    );
  }
  return { url, key, host: parsed.host };
}

function check(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`PASS ${message}`);
}

function requireQuery(result, message) {
  if (result.error) {
    throw new Error(
      `${message} failed (${result.error.code ?? "API_ERROR"}). Verify connectivity, migrations, grants, and RLS in the development project.`,
    );
  }
  return result.data;
}

async function main() {
  const { url, key, host } = configuration();
  const client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
    },
  });
  console.log(`Checking anonymous Data API access at ${host}`);

  const restaurant = requireQuery(
    await client
      .from("restaurants")
      .select(
        "id,slug,name,description,currency,cover_image_url,logo_url,is_published",
      )
      .eq("slug", "mesa")
      .eq("is_published", true)
      .maybeSingle(),
    "Demo restaurant query",
  );
  check(Boolean(restaurant), "Published demo restaurant exists");

  const categories = requireQuery(
    await client
      .from("menu_categories")
      .select("id,restaurant_id,name,description,sort_order,is_active")
      .eq("restaurant_id", restaurant.id)
      .eq("is_active", true),
    "Category query",
  );
  check(categories.length > 0, "Demo restaurant has active menu categories");

  const products = requireQuery(
    await client
      .from("products")
      .select(
        "id,restaurant_id,category_id,name,description,price_minor,image_url,dietary_tags,ingredients,allergens,is_available,sort_order,model_glb_url,model_usdz_url,model_poster_url,model_dimensions_m",
      )
      .eq("restaurant_id", restaurant.id)
      .eq("is_available", true),
    "Product query",
  );
  const categoryIds = new Set(categories.map((category) => category.id));
  check(products.length > 0, "Demo restaurant has available products");
  check(
    products.every((product) => categoryIds.has(product.category_id)),
    "Available products belong to active categories in the same restaurant",
  );

  const groups = requireQuery(
    await client
      .from("product_modifier_groups")
      .select(
        "id,restaurant_id,product_id,min_selections,max_selections,is_active",
      )
      .eq("restaurant_id", restaurant.id)
      .eq("is_active", true),
    "Modifier group query",
  );
  const options = requireQuery(
    await client
      .from("modifier_options")
      .select("id,restaurant_id,group_id,price_adjustment_minor,is_available")
      .eq("restaurant_id", restaurant.id)
      .eq("is_available", true),
    "Modifier option query",
  );
  const productIds = new Set(products.map((product) => product.id));
  const groupIds = new Set(groups.map((group) => group.id));
  check(
    groups.length > 0 &&
      groups.every((group) => productIds.has(group.product_id)),
    "Public demo modifier groups belong to available products",
  );
  check(
    options.length > 0 &&
      options.every((option) => groupIds.has(option.group_id)),
    "Public demo options belong to active groups",
  );
  check(
    groups.every(
      (group) =>
        options.filter((option) => option.group_id === group.id).length >=
        group.min_selections,
    ),
    "Required demo customizations have enough available options",
  );

  for (const [table, field] of [
    ["restaurants", "is_published"],
    ["menu_categories", "is_active"],
    ["products", "is_available"],
    ["product_modifier_groups", "is_active"],
    ["modifier_options", "is_available"],
  ]) {
    const hidden = requireQuery(
      await client.from(table).select("id").eq(field, false).limit(1),
      `${table} visibility check`,
    );
    check(hidden.length === 0, `Anonymous reads do not expose hidden ${table}`);
  }

  for (const table of [
    "dining_tables",
    "restaurant_members",
    "orders",
    "order_items",
  ]) {
    const column = table === "restaurant_members" ? "restaurant_id" : "id";
    const result = await client.from(table).select(column).limit(1);
    check(
      result.error?.code === "42501",
      `Anonymous direct reads of ${table} are denied`,
    );
  }

  const resolved = requireQuery(
    await client.rpc("resolve_table", {
      restaurant_slug: "mesa",
      table_token: randomUUID(),
    }),
    "QR resolver query",
  );
  check(
    resolved.length === 0,
    "QR resolver rejects an unknown token without exposing table records",
  );

  console.log(
    "Public API checks passed. Inspect supabase/verification.sql through an authenticated database connection to verify remote constraints, indexes, policies, and table seed data. This script does not apply migrations or write data.",
  );
}

main().catch((error) => {
  const message =
    error instanceof Error ? error.message : "Verification failed.";
  // Configuration/check errors above contain no key values. Network errors have
  // generic messages; never stringify a Supabase client or its request headers.
  console.error(`Supabase verification incomplete: ${message}`);
  process.exitCode = 1;
});
