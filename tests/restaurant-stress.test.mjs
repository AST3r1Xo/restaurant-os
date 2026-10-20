import { test } from "node:test";
import assert from "node:assert/strict";
import { addCartItem, cartLineKey, cartTotals, resolveCart, subtractPurchasedItems } from "../src/features/cart/model.ts";
import { cartStorageKey, createCartStore, parseCart, serializeCart } from "../src/features/cart/persistence.ts";
import { parseReviewRequest } from "../src/features/orders/payload.ts";
import { intentFingerprint, waitForOrderResponse } from "../src/features/orders/submission-persistence.ts";

// Deterministic state-machine tests: a failure can be reproduced from its seed
// and step. Iterations are operations, not thousands of independent test cases.
function random(seed) {
  let state = seed >>> 0;
  return (max) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return (state >>> 8) % max; };
}
const uuid = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { restaurantId: uuid(1), mode: "live", currency: "EUR", visitKey: uuid(2) };
const product = {
  id: uuid(3), categoryId: uuid(4), name: "Test dish", description: "", imageAlt: "Test dish",
  priceMinor: 1299, ingredients: [], allergens: [], tags: [],
  modifierGroups: [{ id: uuid(5), name: "Extras", selectionType: "multiple", minSelections: 0, maxSelections: 2,
    options: [{ id: uuid(6), name: "Cheese", priceAdjustmentMinor: 125 }, { id: uuid(7), name: "Avocado", priceAdjustmentMinor: 250 }] }],
};
const item = { productId: product.id, optionIds: [], quantity: 1 };
function storage() {
  const data = new Map();
  return { failWrites: false, failReads: false,
    getItem(key) { if (this.failReads) throw new Error("offline storage"); return data.get(key) ?? null; },
    setItem(key, value) { if (this.failWrites) throw new DOMException("Full", "QuotaExceededError"); data.set(key, value); },
    removeItem(key) { data.delete(key); },
  };
}

for (const seed of [1, 42, 20261020, 0xdeadbeef, 987654321]) {
  test(`restaurant rush: cart/reference model agree after 2,000 operations (seed ${seed})`, () => {
    const rnd = random(seed), backing = storage(), store = createCartStore(scope, () => backing);
    const expected = new Map();
    const variants = Array.from({ length: 24 }, (_, n) => ({ ...item, optionIds: n % 2 ? [uuid(6), uuid(7)] : [], notes: `Guest request ${n}` }));
    for (let step = 0; step < 2000; step++) {
      const variant = variants[rnd(variants.length)], key = variant.notes, qty = rnd(3) + 1, action = rnd(5);
      if (action <= 1) {
        const old = expected.get(key) ?? 0;
        if (old + qty <= 99) { store.update(items => addCartItem(items, { ...variant, quantity: qty })); expected.set(key, old + qty); }
        else assert.throws(() => store.update(items => addCartItem(items, { ...variant, quantity: qty })), /99/);
      } else if (action === 2) {
        store.update(items => subtractPurchasedItems(items, [{ ...variant, quantity: qty }]));
        const remaining = Math.max(0, (expected.get(key) ?? 0) - qty);
        if (remaining) expected.set(key, remaining); else expected.delete(key);
      } else if (action === 3) {
        store.load();
      } else {
        const otherTab = createCartStore(scope, () => backing);
        otherTab.update(items => items.filter(i => i.notes !== key));
        expected.delete(key); store.load();
      }
      const actual = store.getSnapshot().items;
      assert.deepEqual(new Map(actual.map(i => [i.notes, i.quantity])), expected, `seed=${seed} step=${step}`);
      const totals = cartTotals(resolveCart(actual, [product]));
      let price = 0, count = 0;
      for (const v of variants) { const q = expected.get(v.notes) ?? 0; count += q; price += q * (1299 + (v.optionIds.length ? 375 : 0)); }
      assert.deepEqual(totals, { count, subtotalMinor: price, hasInvalidItems: false }, `pricing seed=${seed} step=${step}`);
      assert.deepEqual(parseCart(serializeCart(scope, actual), { ...scope, visitKey: uuid(999) }), []);
    }
  });
}

test("full phone storage keeps unsaved cart edits through subsequent edits and visibility reload", () => {
  const backing = storage(), store = createCartStore(scope, () => backing);
  store.update(() => [item]);
  backing.failWrites = true;
  store.update(items => addCartItem(items, item));
  assert.equal(store.getSnapshot().items[0].quantity, 2);
  store.load();
  assert.equal(store.getSnapshot().items[0].quantity, 2, "stale durable data must not replace the in-memory bag");
  assert.equal(store.getSnapshot().storageError, true);
  store.update(items => addCartItem(items, item));
  assert.equal(store.getSnapshot().items[0].quantity, 3);
  backing.failWrites = false;
  store.update(items => addCartItem(items, item));
  assert.equal(store.getSnapshot().items[0].quantity, 4);
  assert.equal(store.getSnapshot().storageError, false);
  assert.equal(parseCart(backing.getItem(cartStorageKey(scope)), scope)[0].quantity, 4);
});

test("storage quota failure cannot resurrect already purchased food or subtract it twice", () => {
  const backing = storage(), store = createCartStore(scope, () => backing);
  store.update(() => [{ ...item, quantity: 5 }]);
  backing.failWrites = true;
  store.clearPurchased("confirmed-1", [{ ...item, quantity: 2 }]);
  store.load();
  store.clearPurchased("confirmed-1", [{ ...item, quantity: 2 }]);
  assert.equal(store.getSnapshot().items[0].quantity, 3);
  backing.failWrites = false;
  store.update(items => addCartItem(items, item));
  assert.equal(store.getSnapshot().items[0].quantity, 4);
  const refreshed = createCartStore(scope, () => backing);
  refreshed.clearPurchased("confirmed-1", [{ ...item, quantity: 2 }]);
  assert.equal(refreshed.getSnapshot().items[0].quantity, 4);
});

test("externally changed cart remains authoritative after storage recovers", () => {
  const backing = storage(), store = createCartStore(scope, () => backing);
  store.update(() => [item]); backing.failWrites = true;
  store.update(items => addCartItem(items, item)); backing.failWrites = false;
  const otherTab = createCartStore(scope, () => backing);
  otherTab.update(() => [{ ...item, notes: "Another tab", quantity: 3 }]);
  store.load();
  assert.deepEqual(store.getSnapshot().items, [{ ...item, quantity: 3, notes: "Another tab" }]);
  assert.equal(store.getSnapshot().storageError, false);
});

test("enabling browser storage after it was blocked retains the in-memory bag", () => {
  const backing = storage();
  let blocked = true;
  const store = createCartStore(scope, () => { if (blocked) throw new DOMException("Blocked", "SecurityError"); return backing; });
  store.update(() => [item]);
  store.update(items => addCartItem(items, item));
  blocked = false;
  store.update(items => addCartItem(items, item));
  assert.equal(store.getSnapshot().items[0].quantity, 3);
  assert.equal(store.getSnapshot().storageError, false);
  assert.equal(parseCart(backing.getItem(cartStorageKey(scope)), scope)[0].quantity, 3);
});

test("2,000 intermittent quota/read failures and recoveries retain quantities and purchase deduplication", () => {
  const rnd = random(82019), backing = storage(), store = createCartStore(scope, () => backing);
  let expected = 0;
  for (let n = 0; n < 2000; n++) {
    backing.failWrites = rnd(4) !== 0;
    backing.failReads = rnd(5) === 0;
    const action = rnd(4);
    if (action === 0 && expected < 99) { store.update(items => addCartItem(items, item)); expected++; }
    else if (action === 1 && expected > 0) {
      store.clearPurchased(`confirmed-${n}`, [item]); expected--;
      store.clearPurchased(`confirmed-${n}`, [item]);
    } else store.load();
    assert.equal(store.getSnapshot().items[0]?.quantity ?? 0, expected, `storage fault step ${n}`);
  }
  backing.failReads = false; backing.failWrites = false;
  store.update(items => items);
  assert.equal(parseCart(backing.getItem(cartStorageKey(scope)), scope)[0]?.quantity ?? 0, expected);
});

test("2,000 randomized intent permutations preserve canonical identity and reject injected authority", () => {
  const rnd = random(192837);
  const request = { restaurantSlug: "test-restaurant", tableToken: uuid(10), visitKey: scope.visitKey };
  for (let n = 0; n < 2000; n++) {
    const lines = [{ ...item, optionIds: [uuid(6), uuid(7)], quantity: rnd(99) + 1, notes: "No onions\nSauce aside" }, { ...item, quantity: rnd(99) + 1, notes: "Other guest" }];
    const canonical = parseReviewRequest({ ...request, items: lines });
    const shuffled = lines.map(l => ({ ...l, productId: l.productId.toUpperCase(), optionIds: [...l.optionIds].reverse(), ...(l.notes ? { notes: ` ${l.notes.replaceAll("\n", "\r\n")} ` } : {}) })).reverse();
    assert.deepEqual(parseReviewRequest({ ...request, items: shuffled }), canonical);
    assert.equal(intentFingerprint(canonical.items), intentFingerprint(lines));
    const field = ["unitPriceMinor", "totalMinor", "customerId", "restaurantId", "tableId", "status"][rnd(6)];
    assert.throws(() => parseReviewRequest({ ...request, items: [{ ...lines[0], [field]: n }] }));
  }
});

test("2,000 corrupted persisted bags fail closed without affecting other visits", () => {
  const rnd = random(7391);
  const corruptions = [v => { v.items[0].quantity = -1; }, v => { v.items[0].quantity = 100; }, v => { v.items[0].quantity = 1.2; },
    v => { v.items[0].optionIds = ["x", "x"]; }, v => { v.items[0].notes = "\u0000"; }, v => { v.items[0].notes = "x".repeat(301); },
    v => { v.visitKey = uuid(111); }, v => { v.restaurantId = uuid(112); }, v => { v.currency = "USD"; }, v => { v.items.push(v.items[0]); }];
  for (let n = 0; n < 2000; n++) {
    const value = JSON.parse(serializeCart(scope, [item])); corruptions[rnd(corruptions.length)](value);
    assert.deepEqual(parseCart(JSON.stringify(value), scope), [], `corruption ${n}`);
  }
});

test("slow response timeout never cancels or invents the eventual committed result", async () => {
  let resolve;
  const response = new Promise(r => { resolve = r; });
  await assert.rejects(waitForOrderResponse(response, 5), /taking longer/);
  resolve({ id: "original-committed-order" });
  assert.deepEqual(await response, { id: "original-committed-order" });
});

test("line identity keeps private special requests distinct while normalizing harmless whitespace", () => {
  for (let n = 0; n < 300; n++) {
    const note = `Request ${n}: ${"é".repeat(n % 20)}`;
    assert.equal(cartLineKey({ ...item, notes: ` ${note}\r\n ` }), cartLineKey({ ...item, notes: note }));
    assert.notEqual(cartLineKey({ ...item, notes: note }), cartLineKey({ ...item, notes: `${note}!` }));
  }
});
