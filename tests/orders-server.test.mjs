import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  parseReviewRequest,
  InvalidOrderPayload,
} from "../src/features/orders/payload.ts";
import { validateOrderOrigin } from "../src/features/orders/request-protection.ts";
import {
  verifiedGuest,
  GuestSessionError,
} from "../src/features/orders/guest-auth.ts";
import {
  guestCookieOptions,
  isGuestCookie,
} from "../src/lib/supabase/guest-cookie.ts";
import {
  fetchOrderReview,
  createGuestOrder,
  fetchGuestOrder,
  submitWithRecovery,
  decodeConfirmedOrder,
  OrderRepositoryError,
} from "../src/features/orders/repository.ts";
import { orderFailure } from "../src/features/orders/errors.ts";

const productId = "44444444-4444-4444-8444-444444444441";
const optionId = "66666666-6666-4666-8666-666666666661";
const tableToken = "67006a2d-d1c1-4ba2-918f-fb8e4ffb1b5c";
const reviewId = "77777777-7777-4777-8777-777777777777";
const key = "88888888-8888-4888-8888-888888888888";
const intent = {
  restaurantSlug: "mesa",
  tableToken,
  visitKey: tableToken,
  items: [{ productId, quantity: 2, optionIds: [optionId] }],
};
const submitted = { ...intent, reviewId, idempotencyKey: key };
const summary = {
  restaurant: {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "mesa",
    name: "Casa Mesa",
  },
  table: { label: "04" },
  currency: "EUR",
  items: [
    {
      productId,
      productName: "Smoked salmon eggs",
      quantity: 2,
      basePriceMinor: 1400,
      unitPriceMinor: 1650,
      lineTotalMinor: 3300,
      options: [
        {
          id: optionId,
          groupId: "55555555-5555-4555-8555-555555555551",
          groupName: "Extras",
          name: "Avocado",
          priceAdjustmentMinor: 250,
        },
      ],
    },
  ],
  totalMinor: 3300,
};
const quote = { ...summary, reviewId, expiresAt: "2026-10-14T13:10:00.000Z" };
const confirmed = {
  ...summary,
  id: "99999999-9999-4999-8999-999999999999",
  reference: "AB12345678",
  status: "pending",
  createdAt: "2026-10-14T13:00:00.000Z",
  subtotalMinor: 3300,
};
const response = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

test("submission parsing admits only canonical purchase intents and opaque review references", () => {
  const parsed = parseReviewRequest(
    {
      ...submitted,
      tableToken: tableToken.toUpperCase(),
      items: [
        {
          productId: productId.toUpperCase(),
          quantity: 2,
          optionIds: [optionId.toUpperCase()],
        },
      ],
    },
    true,
  );
  assert.deepEqual(parsed, submitted);
  assert.throws(
    () => parseReviewRequest({ ...intent, totalMinor: 1 }),
    InvalidOrderPayload,
  );
  for (const field of [
    "customerId",
    "tableId",
    "status",
    "restaurantId",
    "priceMinor",
  ])
    assert.throws(
      () => parseReviewRequest({ ...intent, [field]: "forged" }),
      InvalidOrderPayload,
    );
  assert.throws(
    () =>
      parseReviewRequest({
        ...intent,
        items: [{ ...intent.items[0], priceMinor: 1 }],
      }),
    InvalidOrderPayload,
  );
  assert.throws(
    () => parseReviewRequest({ ...submitted, reviewId: "not-a-uuid" }, true),
    InvalidOrderPayload,
  );
});
test("payload bounds reject empty, duplicate, oversized and invalid quantities", () => {
  const invalid = [
    { ...intent, items: [] },
    { ...intent, tableToken: "invalid" },
    { ...intent, items: [intent.items[0], intent.items[0]] },
    {
      ...intent,
      items: [
        { ...intent.items[0], optionIds: [optionId, optionId.toUpperCase()] },
      ],
    },
    {
      ...intent,
      items: [{ ...intent.items[0], optionIds: Array(51).fill(optionId) }],
    },
    { ...intent, items: [{ ...intent.items[0], quantity: 0 }] },
    { ...intent, items: [{ ...intent.items[0], quantity: 100 }] },
    { ...intent, items: [{ ...intent.items[0], quantity: 1.5 }] },
    { ...intent, restaurantSlug: "a".repeat(65537) },
    {
      ...intent,
      items: Array.from({ length: 6 }, (_, index) => ({
        ...intent.items[0],
        quantity: 99,
        productId: `44444444-4444-4444-8444-44444444444${index}`,
      })),
    },
  ];
  for (const value of invalid)
    assert.throws(() => parseReviewRequest(value), InvalidOrderPayload);
});
test("actions require explicit same-origin requests within their byte limit", () => {
  validateOrderOrigin("http://localhost:3000", "localhost:3000", "1000");
  validateOrderOrigin("https://restaurant.example", "restaurant.example");
  for (const values of [
    [null, "restaurant.example"],
    ["https://evil.example", "restaurant.example"],
    ["null", "restaurant.example"],
    ["https://restaurant.example/path", "restaurant.example"],
    ["https://restaurant.example", "restaurant.example", "65537"],
  ])
    assert.throws(() => validateOrderOrigin(...values), InvalidOrderPayload);
});
test("guest sessions are reused only after remote user verification", async () => {
  let created = 0;
  const client = {
    auth: {
      getUser: async () => ({
        data: { user: { id: "guest", is_anonymous: true } },
        error: null,
      }),
      signInAnonymously: async () => {
        created++;
      },
    },
  };
  assert.equal((await verifiedGuest(client, true)).id, "guest");
  assert.equal((await verifiedGuest(client, false)).id, "guest");
  assert.equal(created, 0);
});
test("review may invisibly establish a guest, but verifies the resulting identity", async () => {
  let calls = 0;
  let created = 0;
  const client = {
    auth: {
      getUser: async () =>
        ++calls === 1
          ? { data: { user: null }, error: { name: "AuthSessionMissingError" } }
          : {
              data: { user: { id: "guest", is_anonymous: true } },
              error: null,
            },
      signInAnonymously: async () => {
        created++;
        return { data: { user: { is_anonymous: true } }, error: null };
      },
    },
  };
  assert.equal((await verifiedGuest(client, true)).id, "guest");
  assert.equal(created, 1);
  assert.equal(calls, 2);
});
test("lost or transient sessions cannot silently create identities during retries", async () => {
  for (const [allowCreate, error, expected] of [
    [false, { name: "AuthSessionMissingError" }, "lost"],
    [true, { name: "AuthRetryableFetchError" }, "unavailable"],
    [false, { name: "AuthRetryableFetchError" }, "unavailable"],
    [true, { code: "refresh_token_already_used" }, "unavailable"],
  ]) {
    const client = {
      auth: {
        getUser: async () => ({ data: { user: null }, error }),
        signInAnonymously: async () =>
          assert.fail("Must not create a replacement identity"),
      },
    };
    await assert.rejects(
      verifiedGuest(client, allowCreate),
      (error) =>
        error instanceof GuestSessionError && error.reason === expected,
    );
  }
});
test("permanent or staff users cannot be used as guest ordering identities", async () => {
  const client = {
    auth: {
      getUser: async () => ({
        data: { user: { id: "staff", is_anonymous: false } },
        error: null,
      }),
      signInAnonymously: async () =>
        assert.fail("Do not replace staff identities"),
    },
  };
  await assert.rejects(
    verifiedGuest(client, true),
    (error) => error.reason === "not_guest",
  );
});
test("guest cookies are HttpOnly and separate from staff/browser cookies", () => {
  const policy = guestCookieOptions("https://project.supabase.co");
  assert.equal(policy.httpOnly, true);
  assert.equal(policy.sameSite, "lax");
  assert.equal(policy.path, "/");
  assert.equal(
    isGuestCookie(`${policy.name}.0`, "https://project.supabase.co"),
    true,
  );
  assert.equal(
    isGuestCookie("sb-project-auth-token", "https://project.supabase.co"),
    false,
  );
  assert.equal(isGuestCookie(policy.name, "https://other.supabase.co"), false);
});
test("review and creation RPCs send no browser authority over ownership or prices", async () => {
  const client = clientWith((url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.restaurant_slug, "mesa");
    assert.equal(body.table_token, tableToken);
    assert.deepEqual(body.items, intent.items);
    if (url.pathname.endsWith("review_visit_order")) {
      assert.deepEqual(Object.keys(body).sort(), [
        "items",
        "restaurant_slug",
        "table_token",
        "visit_key",
      ]);
      return response(quote);
    }
    assert.deepEqual(Object.keys(body).sort(), [
      "idempotency_key",
      "items",
      "restaurant_slug",
      "review_id",
      "table_token",
    ]);
    assert.equal(body.idempotency_key, key);
    assert.equal(body.review_id, reviewId);
    return response(confirmed);
  });
  assert.deepEqual(await fetchOrderReview(client, intent), quote);
  assert.deepEqual(await createGuestOrder(client, submitted), confirmed);
});
test("confirmation lookup uses owner-scoped RPC rather than table or client guest identifiers", async () => {
  const client = clientWith((url, init) => {
    assert.equal(url.pathname, "/rest/v1/rpc/get_guest_order");
    assert.deepEqual(JSON.parse(init.body), {
      restaurant_slug: "mesa",
      order_id: confirmed.id,
    });
    return response({ ...confirmed, customer_id: "private", tableToken });
  });
  assert.deepEqual(
    await fetchGuestOrder(client, "mesa", { orderId: confirmed.id }),
    confirmed,
  );
  assert.equal(
    await fetchGuestOrder(
      clientWith(() => response(null)),
      "mesa",
      { orderId: confirmed.id },
    ),
    null,
  );
});
test("server DTOs reject invalid money, unexpected tenants and incomplete confirmations", () => {
  for (const value of [
    { ...confirmed, totalMinor: 1 },
    { ...confirmed, status: "payment_success" },
    { ...confirmed, items: [] },
    { ...confirmed, restaurant: { ...confirmed.restaurant, slug: "foreign" } },
    { ...confirmed, items: [{ ...confirmed.items[0], unitPriceMinor: 1 }] },
  ])
    assert.throws(
      () => decodeConfirmedOrder(value, "mesa"),
      OrderRepositoryError,
    );
});
test("uncertain network responses recover the original committed order by its key", async () => {
  const calls = [];
  const client = clientWith((url, init) => {
    calls.push(url.pathname);
    if (url.pathname.endsWith("create_guest_order"))
      return response(
        {
          code: "57014",
          message: "Timeout containing sensitive database details",
        },
        500,
      );
    assert.deepEqual(JSON.parse(init.body), {
      restaurant_slug: "mesa",
      idempotency_key: key,
    });
    return response(confirmed);
  });
  assert.deepEqual(await submitWithRecovery(client, submitted), confirmed);
  assert.deepEqual(calls, [
    "/rest/v1/rpc/create_guest_order",
    "/rest/v1/rpc/get_guest_order",
  ]);
});
test("unresolved timeouts retain an uncertain failure rather than fabricating success", async () => {
  const client = clientWith((url) =>
    url.pathname.endsWith("create_guest_order")
      ? response({ code: "57014", message: "Timeout" }, 500)
      : response(null),
  );
  await assert.rejects(
    submitWithRecovery(client, submitted),
    (error) => error.reason === "UNAVAILABLE",
  );
});
test("conflicting idempotency requests are never converted into successful recovery", async () => {
  const client = clientWith((url) => {
    assert.equal(url.pathname, "/rest/v1/rpc/create_guest_order");
    return response({ code: "P0001", message: "IDEMPOTENCY_CONFLICT" }, 400);
  });
  await assert.rejects(
    submitWithRecovery(client, submitted),
    (error) => error.reason === "IDEMPOTENCY_CONFLICT",
  );
});
test("customer failures never disclose unrecognized database messages or credentials", async () => {
  const client = clientWith(() =>
    response(
      { code: "XX000", message: "secret-access-token internal table schema" },
      500,
    ),
  );
  try {
    await fetchOrderReview(client, intent);
    assert.fail("Expected failure");
  } catch (error) {
    const result = orderFailure(error);
    assert.equal(result.ok, false);
    assert.equal(result.code, "unavailable");
    assert.equal(JSON.stringify(result).includes("secret-access-token"), false);
    assert.equal(error.message.includes("schema"), false);
  }
  assert.equal(
    orderFailure(new OrderRepositoryError("ORDER_CHANGED")).code,
    "order_changed",
  );
  assert.equal(
    orderFailure(new GuestSessionError("lost")).code,
    "session_lost",
  );
});
