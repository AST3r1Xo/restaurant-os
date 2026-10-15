import nextEnv from "@next/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { getDataMode, requireSupabaseConfig } from "../src/lib/env.ts";
import { verifiedGuest } from "../src/features/orders/guest-auth.ts";
import {
  createGuestOrder,
  fetchGuestOrder,
  fetchOrderReview,
} from "../src/features/orders/repository.ts";

// Explicit development integration check: creates ONE real order with two
// customized lines and TWO anonymous users. It never alters catalog/table
// records, deletes data, applies SQL, or prints Auth sessions/keys/user IDs.
// Required: ORDER_TEST_TABLE_TOKEN=<one known active QR token>.
nextEnv.loadEnvConfig(process.cwd(), true);
class CheckFailure extends Error {}
let createdOrder;
function check(condition, message) {
  if (!condition) throw new CheckFailure(message);
  console.log(`PASS ${message}`);
}
function requireQuery(result, operation) {
  if (result.error) {
    const safeCode = /^[A-Z0-9_]{1,30}$/.test(result.error.code ?? "")
      ? result.error.code
      : "API_ERROR";
    throw new CheckFailure(`${operation} failed (${safeCode}).`);
  }
  return result.data;
}
function clientWith(url, publishableKey) {
  return createClient(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          cache: "no-store",
          signal: AbortSignal.timeout(20000),
        }),
    },
  });
}
async function rejectRpc(client, name, args, expected) {
  if (name === "review_guest_order") {
    const context = await client.rpc("resolve_table_visit", {
      restaurant_slug: args.restaurant_slug,
      table_token: args.table_token,
    });
    name = "review_visit_order";
    args = { ...args, visit_key: context.data?.[0]?.visit_key ?? randomUUID() };
  }
  const result = await client.rpc(name, args);
  check(
    result.error?.code === "P0001" && expected.includes(result.error?.message),
    `Live RPC rejects ${expected.join("/")}`,
  );
}
async function main() {
  if (getDataMode() !== "live")
    throw new CheckFailure(
      "This real-order check requires APP_DATA_MODE=live or auto with configured Supabase.",
    );
  const { url, publishableKey } = requireSupabaseConfig();
  const restaurantSlug =
    process.env.ORDER_TEST_RESTAURANT_SLUG?.trim() || "mesa";
  const tableToken = process.env.ORDER_TEST_TABLE_TOKEN?.trim();
  if (
    !tableToken ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      tableToken,
    )
  )
    throw new CheckFailure(
      "Set ORDER_TEST_TABLE_TOKEN to one known active table QR token; no table enumeration is performed.",
    );
  const settingsResponse = await fetch(`${url}/auth/v1/settings`, {
    headers: { apikey: publishableKey },
    signal: AbortSignal.timeout(10000),
  });
  if (!settingsResponse.ok)
    throw new CheckFailure("Unable to inspect public Auth settings.");
  const settings = await settingsResponse.json();
  check(
    settings.external?.anonymous_users === true ||
      settings.anonymous_enabled === true,
    "Development Supabase anonymous Auth is enabled",
  );
  const publicClient = clientWith(url, publishableKey);
  const restaurant = requireQuery(
    await publicClient
      .from("restaurants")
      .select("id,slug,is_published,is_accepting_orders,currency")
      .eq("slug", restaurantSlug)
      .eq("is_published", true)
      .maybeSingle(),
    "Restaurant query",
  );
  check(
    !!restaurant?.is_accepting_orders,
    "Development restaurant is published and explicitly accepts orders",
  );
  const table = requireQuery(
    await publicClient.rpc("resolve_table", {
      restaurant_slug: restaurantSlug,
      table_token: tableToken,
    }),
    "Table resolution",
  );
  check(
    table.length === 1,
    "Known active QR resolves in the intended restaurant",
  );
  const categories = requireQuery(
    await publicClient
      .from("menu_categories")
      .select("id")
      .eq("restaurant_id", restaurant.id)
      .eq("is_active", true),
    "Category query",
  );
  const products = requireQuery(
    await publicClient
      .from("products")
      .select("id,category_id,name,price_minor,sort_order")
      .eq("restaurant_id", restaurant.id)
      .eq("is_available", true)
      .order("sort_order")
      .order("id"),
    "Product query",
  );
  const groups = requireQuery(
    await publicClient
      .from("product_modifier_groups")
      .select(
        "id,product_id,min_selections,max_selections,selection_type,sort_order",
      )
      .eq("restaurant_id", restaurant.id)
      .eq("is_active", true)
      .order("sort_order")
      .order("id"),
    "Modifier group query",
  );
  const options = requireQuery(
    await publicClient
      .from("modifier_options")
      .select("id,group_id,price_adjustment_minor,sort_order")
      .eq("restaurant_id", restaurant.id)
      .eq("is_available", true)
      .order("sort_order")
      .order("id"),
    "Modifier option query",
  );
  const categoryIds = new Set(categories.map((category) => category.id));
  const chosen = products
    .filter(
      (product) =>
        categoryIds.has(product.category_id) &&
        groups.some((group) => group.product_id === product.id),
    )
    .slice(0, 2);
  check(
    chosen.length === 2,
    "Published restaurant has two customizable dishes for verification",
  );
  let expectedTotal = 0;
  const items = chosen.map((product, index) => {
    const selected = [];
    for (const group of groups.filter(
      (group) => group.product_id === product.id,
    )) {
      const available = options.filter(
        (option) => option.group_id === group.id,
      );
      if (available.length < group.min_selections)
        throw new CheckFailure(
          "A required customization is currently unavailable.",
        );
      selected.push(...available.slice(0, group.min_selections));
      // Include a real supplement where one optional group permits it.
      if (group.min_selections === 0 && group.max_selections > 0) {
        const extra = available.find(
          (option) => option.price_adjustment_minor > 0,
        );
        if (extra) selected.push(extra);
      }
    }
    const quantity = index === 0 ? 2 : 1;
    expectedTotal +=
      (product.price_minor +
        selected.reduce(
          (sum, option) => sum + option.price_adjustment_minor,
          0,
        )) *
      quantity;
    return {
      productId: product.id,
      quantity,
      optionIds: selected.map((option) => option.id),
    };
  });
  const visitRows = requireQuery(
    await publicClient.rpc("resolve_table_visit", {
      restaurant_slug: restaurantSlug,
      table_token: tableToken,
    }),
    "Current visit context",
  );
  check(visitRows?.length === 1, "Current table visit resolved");
  const request = {
    restaurantSlug,
    tableToken,
    items,
    visitKey: visitRows[0].visit_key,
  };
  const guest = clientWith(url, publishableKey);
  const verified = await verifiedGuest(guest, true);
  check(
    verified.is_anonymous === true,
    "Invisible guest identity is remotely verified without customer contact details",
  );
  const verifiedAgain = await verifiedGuest(guest, false);
  check(
    verifiedAgain.id === verified.id,
    "Existing valid anonymous guest is reused",
  );
  await rejectRpc(
    guest,
    "review_guest_order",
    { restaurant_slug: restaurantSlug, table_token: randomUUID(), items },
    ["TABLE_INVALID"],
  );
  await rejectRpc(
    guest,
    "review_guest_order",
    {
      restaurant_slug: `${restaurantSlug}-does-not-exist`,
      table_token: tableToken,
      items,
    },
    ["RESTAURANT_UNAVAILABLE"],
  );
  await rejectRpc(
    guest,
    "review_guest_order",
    {
      restaurant_slug: restaurantSlug,
      table_token: tableToken,
      items: [{ ...items[0], quantity: 0 }],
    },
    ["QUANTITY_INVALID"],
  );
  await rejectRpc(
    guest,
    "review_guest_order",
    {
      restaurant_slug: restaurantSlug,
      table_token: tableToken,
      items: [
        { ...items[0], priceMinor: 1, totalMinor: 1, customerId: randomUUID() },
      ],
    },
    ["INVALID_REQUEST"],
  );
  await rejectRpc(
    guest,
    "review_guest_order",
    {
      restaurant_slug: restaurantSlug,
      table_token: tableToken,
      items: [{ ...items[0], productId: randomUUID() }],
    },
    ["PRODUCT_UNAVAILABLE"],
  );
  await rejectRpc(
    guest,
    "review_guest_order",
    {
      restaurant_slug: restaurantSlug,
      table_token: tableToken,
      items: [{ ...items[0], optionIds: [randomUUID()] }],
    },
    ["OPTIONS_INVALID"],
  );
  const review = await fetchOrderReview(guest, request);
  check(
    review.totalMinor === expectedTotal && review.items.length === 2,
    "Server review derives correct customized integer prices from live catalog",
  );
  const secondGuest = clientWith(url, publishableKey);
  await verifiedGuest(secondGuest, true);
  const idempotencyKey = randomUUID();
  const args = {
    restaurant_slug: restaurantSlug,
    table_token: tableToken,
    items,
    idempotency_key: idempotencyKey,
    review_id: review.reviewId,
  };
  await rejectRpc(secondGuest, "create_guest_order", args, [
    "SESSION_REQUIRED",
  ]);
  const submitRequest = {
    ...request,
    idempotencyKey,
    reviewId: review.reviewId,
  };
  // Independent concurrent HTTP requests reach PostgreSQL; this is not PGlite's
  // single-session queue. The database must serialize and return one order.
  const attempts = await Promise.allSettled(
    Array.from({ length: 3 }, () => createGuestOrder(guest, submitRequest)),
  );
  const submitted = attempts
    .filter((attempt) => attempt.status === "fulfilled")
    .map((attempt) => attempt.value);
  createdOrder =
    submitted[0] ??
    (await fetchGuestOrder(guest, restaurantSlug, { idempotencyKey }));
  if (!createdOrder)
    throw new CheckFailure(
      "The submission result is uncertain. Check the development database before running this script again.",
    );
  check(
    submitted.length === 3,
    "All three concurrent submission responses completed successfully",
  );
  check(
    submitted.every(
      (order) =>
        order.id === createdOrder.id &&
        order.reference === createdOrder.reference,
    ),
    "Three concurrent identical submissions return one real confirmed order",
  );
  check(
    createdOrder.status === "pending" &&
      createdOrder.totalMinor === expectedTotal &&
      createdOrder.items.length === 2,
    "Real order is pending with two correctly priced item snapshots",
  );
  const owned = requireQuery(
    await guest
      .from("orders")
      .select(
        "id,restaurant_id,customer_id,status,total_minor,table_label,restaurant_name",
      )
      .eq("restaurant_id", restaurant.id)
      .eq("idempotency_key", idempotencyKey),
    "Owner order verification",
  );
  check(
    owned.length === 1 &&
      owned[0].id === createdOrder.id &&
      owned[0].customer_id === verified.id &&
      owned[0].status === "pending" &&
      owned[0].total_minor === expectedTotal &&
      owned[0].table_label === table[0].table_label &&
      owned[0].restaurant_name === createdOrder.restaurant.name,
    "RLS owner query verifies one persisted order with correct guest, tenant and table label",
  );
  const persistedItems = requireQuery(
    await guest
      .from("order_items")
      .select(
        "product_id,product_name,quantity,base_price_minor,unit_price_minor,line_total_minor,selected_options,restaurant_id",
      )
      .eq("restaurant_id", restaurant.id)
      .eq("order_id", createdOrder.id),
    "Owner item verification",
  );
  check(
    persistedItems.length === 2 &&
      persistedItems.reduce((sum, item) => sum + item.line_total_minor, 0) ===
        expectedTotal &&
      persistedItems.every(
        (item) =>
          item.restaurant_id === restaurant.id &&
          Array.isArray(item.selected_options) &&
          item.selected_options.length > 0,
      ),
    "Persisted order items contain correct tenant, quantities, modifier snapshots and line totals",
  );
  const snapshotLines = persistedItems
    .map((item) => ({
      productId: item.product_id,
      productName: item.product_name,
      quantity: item.quantity,
      basePriceMinor: item.base_price_minor,
      unitPriceMinor: item.unit_price_minor,
      lineTotalMinor: item.line_total_minor,
      options: item.selected_options,
    }))
    .sort((a, b) => a.productId.localeCompare(b.productId));
  assert.deepEqual(
    snapshotLines,
    [...createdOrder.items].sort((a, b) =>
      a.productId.localeCompare(b.productId),
    ),
  );
  check(
    true,
    "Every persisted product/modifier snapshot matches the confirmed server response",
  );
  assert.deepEqual(
    await fetchGuestOrder(guest, restaurantSlug, { idempotencyKey }),
    createdOrder,
  );
  check(
    true,
    "Original idempotency key recovers the confirmed server snapshot",
  );
  assert.deepEqual(
    await createGuestOrder(guest, {
      ...submitRequest,
      items: items
        .toReversed()
        .map((item) => ({ ...item, optionIds: item.optionIds.toReversed() })),
    }),
    createdOrder,
  );
  check(
    true,
    "Canonical item/option reordering safely replays the same confirmed order",
  );
  await rejectRpc(
    guest,
    "create_guest_order",
    {
      ...args,
      items: [{ ...items[0], quantity: items[0].quantity + 1 }, items[1]],
    },
    ["IDEMPOTENCY_CONFLICT"],
  );
  await rejectRpc(
    guest,
    "create_guest_order",
    { ...args, table_token: randomUUID() },
    ["IDEMPOTENCY_CONFLICT"],
  );
  check(
    (await fetchGuestOrder(secondGuest, restaurantSlug, {
      orderId: createdOrder.id,
    })) === null,
    "Another guest sharing the QR cannot obtain private confirmation",
  );
  const foreignOrders = requireQuery(
    await secondGuest
      .from("orders")
      .select("id")
      .eq("restaurant_id", restaurant.id)
      .eq("id", createdOrder.id),
    "Foreign owner order check",
  );
  const foreignItems = requireQuery(
    await secondGuest
      .from("order_items")
      .select("id")
      .eq("restaurant_id", restaurant.id)
      .eq("order_id", createdOrder.id),
    "Foreign owner item check",
  );
  check(
    foreignOrders.length === 0 && foreignItems.length === 0,
    "RLS denies the second guest access to first guest order and items",
  );
  const direct = await secondGuest.from("orders").insert({
    restaurant_id: restaurant.id,
    table_id: randomUUID(),
    customer_id: verified.id,
    currency: restaurant.currency,
    subtotal_minor: 1,
    total_minor: 1,
  });
  check(
    direct.error?.code === "42501",
    "Direct client inserts cannot bypass trusted creation",
  );
  const finalOwned = requireQuery(
    await guest
      .from("orders")
      .select("id")
      .eq("restaurant_id", restaurant.id)
      .eq("idempotency_key", idempotencyKey),
    "Final order count",
  );
  check(
    finalOwned.length === 1 && finalOwned[0].id === createdOrder.id,
    "All replay/conflict/authorization checks leave exactly one intended order",
  );
  console.log(
    "Live development order verification passed. Existing restaurant/table/catalog records were not changed; the confirmed order and anonymous users are retained.",
  );
}
main()
  .catch((error) => {
    // Only our bounded diagnostic messages are printable. Do not expose SDK
    // errors, headers, session objects, request payloads or user identifiers.
    console.error(
      error instanceof CheckFailure
        ? `Live order verification incomplete: ${error.message}`
        : "Live order verification incomplete. Check connectivity, current migrations and Auth configuration.",
    );
    process.exitCode = 1;
  })
  .finally(() => {
    if (createdOrder)
      console.log(
        `CREATED_ORDER ${JSON.stringify({ id: createdOrder.id, reference: createdOrder.reference, totalMinor: createdOrder.totalMinor, items: createdOrder.items.length })}`,
      );
  });
