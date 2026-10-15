import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  fetchPublishedRestaurant,
  fetchMenuRows,
  fetchTableContext,
  mapMenuRows,
  safeMenuImage,
} from "../src/features/menu/repository.ts";
import { normalizeTableToken, customerPath } from "../src/lib/routes.ts";
import { getDataMode } from "../src/lib/env.ts";

function clientWith(handler) {
  return createClient("https://test.supabase.co", "sb_publishable_test", {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: async (input, init) =>
        handler(new URL(input instanceof Request ? input.url : input), init),
    },
  });
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("restaurant queries explicitly require the requested published slug", async () => {
  const client = clientWith((url) => {
    assert.equal(url.pathname, "/rest/v1/restaurants");
    assert.equal(url.searchParams.get("slug"), "eq.mesa");
    assert.equal(url.searchParams.get("is_published"), "eq.true");
    return json([{ id: "r1", slug: "mesa", name: "Live name" }]);
  });
  assert.equal(
    (await fetchPublishedRestaurant(client, "mesa")).name,
    "Live name",
  );
});

test("missing or unpublished restaurants remain absent", async () => {
  assert.equal(
    await fetchPublishedRestaurant(
      clientWith(() => json([])),
      "unknown",
    ),
    null,
  );
});

test("menu queries isolate the tenant, respect visibility, and exclude inactive categories", async () => {
  const client = clientWith((url) => {
    assert.equal(url.searchParams.get("restaurant_id"), "eq.r1");
    if (url.pathname.endsWith("menu_categories")) {
      assert.equal(url.searchParams.get("is_active"), "eq.true");
      return json([
        { id: "c1", name: "Mains", description: "", sort_order: 0 },
      ]);
    }
    assert.equal(url.searchParams.get("is_available"), "eq.true");
    return json([
      { id: "p1", category_id: "c1" },
      { id: "p2", category_id: "inactive" },
    ]);
  });
  const rows = await fetchMenuRows(client, "r1");
  assert.deepEqual(
    rows.products.map((item) => item.id),
    ["p1"],
  );
});

test("live failures reject rather than return fixtures or incomplete menus", async () => {
  const client = clientWith(() =>
    json({ code: "XX000", message: "Internal failure" }, 500),
  );
  await assert.rejects(
    fetchPublishedRestaurant(client, "mesa"),
    /Unable to load restaurant/,
  );
  await assert.rejects(
    fetchMenuRows(client, "r1"),
    /Unable to load menu categories/,
  );
  await assert.rejects(
    fetchTableContext(client, "mesa", "22222222-2222-4222-8222-222222222222"),
    /Unable to load table context/,
  );
});

test("QR resolution invokes only the scoped RPC and returns its server label", async () => {
  const token = "22222222-2222-4222-8222-222222222222";
  const client = clientWith((url, init) => {
    assert.equal(url.pathname, "/rest/v1/rpc/resolve_table_visit");
    assert.deepEqual(JSON.parse(init.body), {
      restaurant_slug: "mesa",
      table_token: token,
    });
    return json([{ table_label: "Patio 7", visit_key: token }]);
  });
  assert.deepEqual(await fetchTableContext(client, "mesa", token), {
    status: "valid",
    label: "Patio 7",
    token,
    visitKey: token,
  });
});

test("missing, malformed, or duplicated tokens do not trigger a table query", async () => {
  const client = clientWith(() => {
    throw new Error("Unexpected network call");
  });
  assert.deepEqual(
    await fetchTableContext(client, "mesa", normalizeTableToken(undefined)),
    { status: "missing" },
  );
  for (const value of ["", "invalid", "x".repeat(20000), ["a", "b"]]) {
    assert.deepEqual(
      await fetchTableContext(client, "mesa", normalizeTableToken(value)),
      { status: "invalid" },
    );
  }
});

test("unknown or deactivated QR results remain invalid", async () => {
  assert.deepEqual(
    await fetchTableContext(
      clientWith(() => json([])),
      "mesa",
      "22222222-2222-4222-8222-222222222222",
    ),
    { status: "invalid" },
  );
});

test("validated tokens are canonical and preserved in customer paths", () => {
  const token = normalizeTableToken("ABCDEF12-3456-4789-ABCD-EF1234567890");
  assert.equal(token, "abcdef12-3456-4789-abcd-ef1234567890");
  assert.equal(
    customerPath("mesa", "cart", token),
    `/r/mesa/cart?table=${token}`,
  );
});

test("live mapping preserves prices and supports empty menus and absent photos/tags", () => {
  const restaurant = {
    slug: "live",
    name: "Live restaurant",
    currency: "EUR",
    description: "",
    cover_image_url: null,
  };
  const menu = mapMenuRows(
    restaurant,
    { categories: [], products: [] },
    "https://test.supabase.co",
  );
  assert.deepEqual(menu.categories, []);
  assert.deepEqual(menu.products, []);
  assert.equal(menu.coverImage, undefined);
  const withDish = mapMenuRows(
    restaurant,
    {
      categories: [{ id: "c1", name: "Mains", description: "" }],
      products: [
        {
          id: "p1",
          category_id: "c1",
          name: "Dish",
          description: "",
          price_minor: 1234,
          image_url: null,
          dietary_tags: [],
        },
      ],
    },
    "https://test.supabase.co",
  );
  assert.equal(withDish.products[0].priceMinor, 1234);
  assert.deepEqual(withDish.products[0].tags, []);
});

test("image sources exclude private storage, unsupported origins, and traversal", () => {
  const url = "https://test.supabase.co";
  assert.equal(safeMenuImage("/images/pasta.jpg", url), "/images/pasta.jpg");
  assert.equal(
    safeMenuImage(`${url}/storage/v1/object/public/menu/pasta.jpg`, url),
    `${url}/storage/v1/object/public/menu/pasta.jpg`,
  );
  for (const source of [
    `${url}/storage/v1/object/authenticated/menu/pasta.jpg`,
    "https://other.example/dish.jpg",
    "/images/../secret.jpg",
    "http://127.0.0.1/file.jpg",
  ])
    assert.equal(safeMenuImage(source, url), undefined);
});

test("data mode is explicit; partial configuration and privileged keys cannot become demo fallbacks", () => {
  const keys = [
    "APP_DATA_MODE",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ];
  const original = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );
  try {
    for (const key of keys) delete process.env[key];
    assert.equal(getDataMode(), "demo");
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    assert.throws(() => getDataMode(), /Set both/);
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
    assert.equal(getDataMode(), "live");
    process.env.APP_DATA_MODE = "demo";
    assert.equal(getDataMode(), "demo");
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_secret_test";
    assert.throws(() => getDataMode(), /privileged/);
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    process.env.APP_DATA_MODE = "live";
    assert.throws(() => getDataMode(), /Live mode requires/);
  } finally {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
});

test("modifier queries filter tenant and availability; mapping binds options to the correct product", async () => {
  const { fetchModifierRows, attachModifiers } =
    await import("../src/features/menu/repository.ts");
  const client = clientWith((url) => {
    assert.equal(url.searchParams.get("restaurant_id"), "eq.r1");
    if (url.pathname.endsWith("product_modifier_groups")) {
      assert.equal(url.searchParams.get("is_active"), "eq.true");
      return json([
        {
          id: "g1",
          product_id: "p1",
          name: "Sauce",
          description: "",
          selection_type: "single",
          min_selections: 1,
          max_selections: 1,
        },
        { id: "foreign", product_id: "other-product", name: "Other" },
      ]);
    }
    assert.equal(url.searchParams.get("is_available"), "eq.true");
    return json([
      { id: "o1", group_id: "g1", name: "Basil", price_adjustment_minor: 150 },
      { id: "o2", group_id: "foreign", name: "Hidden" },
    ]);
  });
  const result = attachModifiers(
    { products: [{ id: "p1", modifierGroups: [] }] },
    await fetchModifierRows(client, "r1"),
  );
  assert.equal(result.products[0].modifierGroups.length, 1);
  assert.deepEqual(result.products[0].modifierGroups[0].options, [
    { id: "o1", name: "Basil", priceAdjustmentMinor: 150 },
  ]);
});
test("modifier query failures never create a customization-free fallback", async () => {
  const { fetchModifierRows } =
    await import("../src/features/menu/repository.ts");
  await assert.rejects(
    fetchModifierRows(
      clientWith(() => json({ code: "XX000" }, 500)),
      "r1",
    ),
    /customization groups/,
  );
});
