import { test } from "node:test";
import assert from "node:assert/strict";
import {
  discardStoredSubmission,
  intentFingerprint,
  parseStoredSubmission,
  readStoredSubmission,
  saveStoredSubmission,
  submissionStorageKey,
  waitForOrderResponse,
  withSubmissionLock,
} from "../src/features/orders/submission-persistence.ts";

const ids = {
  restaurant: "11111111-1111-4111-8111-111111111111",
  product: "44444444-4444-4444-8444-444444444441",
  option: "66666666-6666-4666-8666-666666666661",
  group: "55555555-5555-4555-8555-555555555551",
  token: "22222222-2222-4222-8222-222222222222",
  review: "77777777-7777-4777-8777-777777777777",
  key: "88888888-8888-4888-8888-888888888888",
  order: "99999999-9999-4999-8999-999999999999",
};
const scope = {
  restaurantId: ids.restaurant,
  mode: "live",
  currency: "EUR",
  visitKey: ids.token,
};
const items = [
  { productId: ids.product, optionIds: [ids.option], quantity: 2 },
];
const review = {
  reviewId: ids.review,
  restaurant: { id: ids.restaurant, slug: "mesa", name: "Casa Mesa" },
  table: { label: "Table 04" },
  currency: "EUR",
  totalMinor: 3300,
  expiresAt: "2030-01-01T00:00:00.000Z",
  items: [
    {
      productId: ids.product,
      productName: "Smoked salmon eggs",
      quantity: 2,
      basePriceMinor: 1400,
      unitPriceMinor: 1650,
      lineTotalMinor: 3300,
      options: [
        {
          id: ids.option,
          groupId: ids.group,
          groupName: "Extras",
          name: "Avocado",
          priceAdjustmentMinor: 250,
        },
      ],
    },
  ],
};
const attempt = {
  version: 2,
  ...scope,
  request: {
    restaurantSlug: "mesa",
    tableToken: ids.token,
    visitKey: ids.token,
    items,
    reviewId: ids.review,
    idempotencyKey: ids.key,
  },
  review,
};
function memoryStorage() {
  const entries = new Map();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
    entries,
  };
}
test("saved submission retains the exact key, review and frozen intents after refresh", () => {
  const storage = memoryStorage();
  saveStoredSubmission(storage, scope, attempt);
  const restored = readStoredSubmission(storage, scope);
  assert.deepEqual(restored, attempt);
  assert.equal(restored.request.idempotencyKey, ids.key);
  assert.equal(restored.request.reviewId, ids.review);
  assert.ok(
    !/access_token|refresh_token|customer_id|password/i.test(
      storage.getItem(submissionStorageKey(scope)),
    ),
  );
});
test("submission persistence rejects other tenants, demo mode and inconsistent currency", () => {
  const raw = JSON.stringify(attempt);
  for (const other of [
    { ...scope, restaurantId: "another-restaurant" },
    { ...scope, mode: "demo" },
    { ...scope, currency: "USD" },
  ])
    assert.equal(parseStoredSubmission(raw, other), null);
  assert.notEqual(
    submissionStorageKey(scope),
    submissionStorageKey({ ...scope, restaurantId: "other" }),
  );
});
test("malformed pending records cannot silently become a new submission", () => {
  const storage = memoryStorage();
  storage.setItem(submissionStorageKey(scope), "broken JSON");
  assert.throws(
    () => readStoredSubmission(storage, scope),
    /check whether your order arrived/,
  );
  for (const value of [
    { ...attempt, request: { ...attempt.request, idempotencyKey: "bad" } },
    { ...attempt, request: { ...attempt.request, totalMinor: 0 } },
    { ...attempt, review: { ...review, reviewId: ids.key } },
    { ...attempt, review: { ...review, totalMinor: -1 } },
    {
      ...attempt,
      request: { ...attempt.request, items: [{ ...items[0], quantity: 3 }] },
    },
    { ...attempt, confirmedOrderId: "bad" },
  ])
    assert.equal(parseStoredSubmission(JSON.stringify(value), scope), null);
});
test("blocked storage prevents sending an attempt without a durable retry key", () => {
  const blocked = {
    getItem: () => null,
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {},
  };
  assert.throws(() => saveStoredSubmission(blocked, scope, attempt), /blocked/);
  const silent = { ...blocked, setItem: () => {} };
  assert.throws(
    () => saveStoredSubmission(silent, scope, attempt),
    /safe retry/,
  );
});
test("discarding a resolved failure never removes a different in-flight attempt", () => {
  const storage = memoryStorage();
  saveStoredSubmission(storage, scope, attempt);
  discardStoredSubmission(storage, scope, ids.order);
  assert.ok(readStoredSubmission(storage, scope));
  discardStoredSubmission(storage, scope, ids.key);
  assert.equal(readStoredSubmission(storage, scope), null);
});
test("confirmed local references retain the original key without storing a fake confirmation", () => {
  const storage = memoryStorage();
  saveStoredSubmission(storage, scope, {
    ...attempt,
    confirmedOrderId: ids.order,
  });
  const restored = readStoredSubmission(storage, scope);
  assert.equal(restored.confirmedOrderId, ids.order);
  assert.equal(restored.request.idempotencyKey, ids.key);
  // The confirmation page must independently query the server; there is no
  // success status, ownership, or private order snapshot in this receipt.
  assert.equal(restored.status, undefined);
  assert.equal(restored.customerId, undefined);
});
test("intent fingerprints ignore option/line ordering but distinguish quantities", () => {
  const additional = {
    productId: ids.order,
    optionIds: [ids.group, ids.option],
    quantity: 1,
  };
  assert.equal(
    intentFingerprint([...items, additional]),
    intentFingerprint([
      { ...additional, optionIds: [...additional.optionIds].reverse() },
      ...items,
    ]),
  );
  assert.notEqual(
    intentFingerprint(items),
    intentFingerprint([{ ...items[0], quantity: 3 }]),
  );
});
test("browser locking serializes competing tabs before their shared attempt is read", async () => {
  let tail = Promise.resolve();
  const locks = {
    request: (_name, run) => {
      const result = tail.then(run);
      tail = result.catch(() => {});
      return result;
    },
  };
  const storage = memoryStorage();
  let created = 0;
  const trySubmit = () =>
    withSubmissionLock(scope, locks, async () => {
      let saved = readStoredSubmission(storage, scope);
      if (!saved) {
        created++;
        saveStoredSubmission(storage, scope, attempt);
        saved = attempt;
      }
      await Promise.resolve();
      return saved.request.idempotencyKey;
    });
  assert.deepEqual(await Promise.all([trySubmit(), trySubmit()]), [
    ids.key,
    ids.key,
  ]);
  assert.equal(created, 1);
  await assert.rejects(
    withSubmissionLock(scope, undefined, async () => {}),
    /current version/,
  );
});
test("an uncertain timeout preserves the original attempt for recovery and safe retries", async () => {
  const storage = memoryStorage();
  saveStoredSubmission(storage, scope, attempt);
  await assert.rejects(
    waitForOrderResponse(new Promise(() => {}), 2),
    /original order reference/,
  );
  assert.deepEqual(
    readStoredSubmission(storage, scope).request,
    attempt.request,
  );
  assert.equal(
    await waitForOrderResponse(Promise.resolve("confirmed"), 100),
    "confirmed",
  );
});

test("transport and browser errors have meaningful bounded customer messages", async () => {
  const { submissionFailureMessage } =
    await import("../src/features/orders/submission-persistence.ts");
  assert.match(
    submissionFailureMessage(new TypeError("Failed to fetch")),
    /same order reference/,
  );
  assert.ok(
    !submissionFailureMessage(
      new Error("database internals access_token=secret"),
    ).includes("secret"),
  );
  const blocked = new Error("internal browser settings");
  blocked.name = "SecurityError";
  assert.match(submissionFailureMessage(blocked), /allow browser storage/);
  const purposeful = "Your bag changed in another tab. Please review it again.";
  assert.equal(submissionFailureMessage(new Error(purposeful)), purposeful);
});

test("a persisted review and idempotency reference cannot carry into the next visit", () => {
  const storage = memoryStorage();
  saveStoredSubmission(storage, scope, attempt);
  const next = { ...scope, visitKey: ids.review };
  assert.equal(parseStoredSubmission(JSON.stringify(attempt), next), null);
  assert.equal(readStoredSubmission(storage, next), null);
  assert.notEqual(submissionStorageKey(scope), submissionStorageKey(next));
});
