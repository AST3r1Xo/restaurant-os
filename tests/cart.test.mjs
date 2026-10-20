import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addCartItem,
  cartLineKey,
  cartTotals,
  productRevision,
  resolveCart,
  subtractPurchasedItems,
  validateSelection,
  updateCartItemNotes,
} from "../src/features/cart/model.ts";
import {
  cartStorageKey,
  createCartStore,
  parseCart,
  serializeCart,
  purgeOtherVisitStorage,
} from "../src/features/cart/persistence.ts";
const product = {
  id: "p1",
  categoryId: "c1",
  name: "Dish",
  description: "",
  priceMinor: 1400,
  imageAlt: "Dish",
  tags: [],
  ingredients: [],
  allergens: [],
  modifierGroups: [
    {
      id: "base",
      name: "Bread",
      description: "",
      selectionType: "single",
      minSelections: 1,
      maxSelections: 1,
      options: [
        { id: "bread", name: "Brioche", priceAdjustmentMinor: 0 },
        { id: "toast", name: "Toast", priceAdjustmentMinor: 0 },
      ],
    },
    {
      id: "extras",
      name: "Extras",
      description: "",
      selectionType: "multiple",
      minSelections: 0,
      maxSelections: 2,
      options: [
        { id: "egg", name: "Egg", priceAdjustmentMinor: 200 },
        { id: "avocado", name: "Avocado", priceAdjustmentMinor: 250 },
        { id: "cheese", name: "Cheese", priceAdjustmentMinor: 150 },
      ],
    },
  ],
};
const scope = { restaurantId: "r1", mode: "live", currency: "EUR" };
const item = {
  productId: "p1",
  optionIds: ["bread", "egg", "avocado"],
  quantity: 2,
};
test("special requests keep otherwise identical dishes separate and persist through refresh", () => {
  const first = { ...item, notes: "  No onions\r\nSauce on the side  " };
  const second = { ...item, notes: "Extra onions" };
  const items = addCartItem(addCartItem([], first), second);
  assert.equal(items.length, 2);
  assert.equal(items[0].notes, "No onions\nSauce on the side");
  assert.deepEqual(parseCart(serializeCart(scope, items), scope), items);
  assert.equal(cartTotals(resolveCart(items, [product])).subtotalMinor, 7400);
  assert.equal(addCartItem(items, { ...first, quantity: 1 })[0].quantity, 3);
  assert.equal(cartLineKey(item), cartLineKey({ ...item, notes: " \n" }));
});
test("special request edits merge matching requests safely and purchased cleanup respects notes", () => {
  const a = { ...item, notes: "No onions" }, b = { ...item, notes: "Sauce on the side", quantity: 1 };
  const edited = updateCartItemNotes([a, b], cartLineKey(a), " Sauce on the side ");
  assert.deepEqual(edited, [{ ...b, quantity: 3 }]);
  assert.deepEqual(subtractPurchasedItems([a, b], [a]), [b]);
  assert.throws(() => updateCartItemNotes([{ ...a, quantity: 99 }, b], cartLineKey(b), a.notes), /99/);
  for (const notes of ["x".repeat(301), "\u0001hidden"]) {
    assert.throws(() => addCartItem([], { ...item, notes }));
    assert.deepEqual(parseCart(serializeCart(scope, [{ ...item, notes }]), scope), []);
  }
});
function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    values,
  };
}

test("cart prices base and options per unit using integer minor units", () => {
  const lines = resolveCart([item], [product]);
  assert.equal(lines[0].unitPriceMinor, 1850);
  assert.equal(lines[0].totalMinor, 3700);
  assert.deepEqual(cartTotals(lines), {
    count: 2,
    subtotalMinor: 3700,
    hasInvalidItems: false,
  });
});
test("required groups, single-choice and multi-choice limits are enforced", () => {
  assert.match(validateSelection(product, [], 1), /at least 1/);
  assert.match(validateSelection(product, ["bread", "toast"], 1), /up to 1/);
  assert.match(
    validateSelection(product, ["bread", "egg", "avocado", "cheese"], 1),
    /up to 2/,
  );
  assert.equal(validateSelection(product, ["bread"], 1), null);
});
test("multi-select minimums and empty required groups cannot be bypassed", () => {
  const custom = {
    ...product,
    modifierGroups: [{ ...product.modifierGroups[1], minSelections: 2 }],
  };
  assert.match(validateSelection(custom, ["egg"], 1), /at least 2/);
  assert.equal(validateSelection(custom, ["egg", "avocado"], 1), null);
  assert.match(
    validateSelection(
      {
        ...product,
        modifierGroups: [{ ...product.modifierGroups[0], options: [] }],
      },
      [],
      1,
    ),
    /at least 1/,
  );
});
test("unknown, duplicated and foreign-product options are rejected", () => {
  for (const ids of [
    ["bread", "other-restaurant-option"],
    ["bread", "bread"],
    ["bread", 1],
    null,
  ])
    assert.ok(validateSelection(product, ids, 1));
});
test("quantities and unsafe integer arithmetic cannot enter a valid cart", () => {
  for (const value of [0, -1, 100, 1.5, NaN, "2", null])
    assert.ok(validateSelection(product, ["bread"], value));
  assert.ok(
    validateSelection(
      { ...product, priceMinor: Number.MAX_SAFE_INTEGER },
      ["bread"],
      2,
    ),
  );
  assert.equal(validateSelection(product, ["bread"], 99), null);
});
test("identical selections merge independent of option order; customized dishes remain separate", () => {
  const a = addCartItem([], item);
  const b = addCartItem(a, {
    ...item,
    optionIds: [...item.optionIds].reverse(),
    quantity: 1,
  });
  assert.equal(b.length, 1);
  assert.equal(b[0].quantity, 3);
  const c = addCartItem(b, { ...item, optionIds: ["bread"], quantity: 1 });
  assert.equal(c.length, 2);
  assert.equal(
    cartLineKey(item),
    cartLineKey({ ...item, optionIds: [...item.optionIds].reverse() }),
  );
});
test("merged lines cannot exceed quantity and cart capacity limits", () => {
  assert.throws(() => addCartItem([{ ...item, quantity: 99 }], item), /99/);
  assert.throws(
    () =>
      addCartItem(
        Array.from({ length: 100 }, (_, i) => ({
          ...item,
          productId: String(i),
        })),
        item,
      ),
    /full/,
  );
});
test("unavailable products and changed selections stay visible but are excluded from totals", () => {
  const lines = resolveCart(
    [item, { ...item, productId: "hidden" }],
    [{ ...product, modifierGroups: [] }],
  );
  assert.equal(lines.length, 2);
  assert.ok(lines.every((line) => line.error));
  assert.deepEqual(cartTotals(lines), {
    count: 0,
    subtotalMinor: 0,
    hasInvalidItems: true,
  });
});
test("restored prices are re-derived from current definitions, not saved snapshots", () => {
  const restored = parseCart(serializeCart(scope, [item]), scope);
  const changed = { ...product, priceMinor: 1600 };
  assert.equal(resolveCart(restored, [changed])[0].totalMinor, 4100);
  assert.notEqual(productRevision(product), productRevision(changed));
});
test("persistence stores only purchase intents, without QR, prices or authentication", () => {
  const raw = serializeCart(scope, [item]);
  assert.deepEqual(parseCart(raw, scope), [
    { ...item, optionIds: [...item.optionIds].sort() },
  ]);
  assert.ok(!/price|token|table|auth/i.test(raw));
  const tampered = JSON.parse(raw);
  tampered.items[0].unitPriceMinor = 0;
  assert.equal(
    resolveCart(parseCart(JSON.stringify(tampered), scope), [product])[0]
      .unitPriceMinor,
    1850,
  );
});
test("storage is isolated by restaurant, mode and currency", () => {
  const raw = serializeCart(scope, [item]);
  for (const other of [
    { ...scope, restaurantId: "r2" },
    { ...scope, mode: "demo" },
    { ...scope, currency: "USD" },
  ])
    assert.deepEqual(parseCart(raw, other), []);
  assert.notEqual(
    cartStorageKey(scope),
    cartStorageKey({ ...scope, restaurantId: "r2" }),
  );
  assert.notEqual(
    cartStorageKey(scope),
    cartStorageKey({ ...scope, mode: "demo" }),
  );
  assert.ok(
    resolveCart([item], [{ ...product, id: "other-tenant-product" }])[0].error,
  );
});
test("malformed, oversized or unsupported persistence cannot hydrate arbitrary items", () => {
  for (const raw of [
    "bad json",
    "null",
    "x".repeat(200001),
    JSON.stringify({ version: 1, ...scope, items: [item] }),
    serializeCart(scope, [{ ...item, quantity: 0 }]),
    serializeCart(scope, [item, item]),
    serializeCart(scope, [{ ...item, optionIds: ["bread", "bread"] }]),
  ])
    assert.deepEqual(parseCart(raw, scope), []);
});
test("the store survives refresh, supports removal and publishes immediate updates", () => {
  const storage = memoryStorage();
  const store = createCartStore(scope, () => storage);
  let calls = 0;
  const unsubscribe = store.subscribe(() => {
    calls++;
  });
  store.update((items) => addCartItem(items, item));
  assert.equal(calls, 2);
  assert.equal(store.getSnapshot().items.length, 1);
  const refreshed = createCartStore(scope, () => storage);
  refreshed.load();
  assert.equal(refreshed.getSnapshot().items[0].quantity, 2);
  refreshed.update((items) => items.map((line) => ({ ...line, quantity: 3 })));
  store.load();
  assert.equal(store.getSnapshot().items[0].quantity, 3);
  store.update(() => []);
  assert.deepEqual(
    parseCart(storage.getItem(cartStorageKey(scope)), scope),
    [],
  );
  unsubscribe();
});
test("blocked storage preserves the in-memory bag with an explicit status", () => {
  const store = createCartStore(scope, () => {
    throw new Error("blocked");
  });
  store.load();
  store.update((items) => addCartItem(items, item));
  assert.equal(store.getSnapshot().storageError, true);
  assert.equal(store.getSnapshot().items.length, 1);
  store.load();
  assert.equal(store.getSnapshot().items.length, 1);
});
test("successful purchase removes only purchased quantities and customizations", () => {
  const other = { ...item, optionIds: ["bread"], quantity: 1 };
  assert.deepEqual(
    subtractPurchasedItems([{ ...item, quantity: 5 }, other], [item]),
    [{ ...item, quantity: 3 }, other],
  );
  assert.deepEqual(subtractPurchasedItems([item], [item]), []);
});
test("confirmation cleanup survives refresh without removing later additions twice", () => {
  const storage = memoryStorage();
  const store = createCartStore(scope, () => storage);
  store.update(() => [{ ...item, quantity: 5 }]);
  store.clearPurchased("order-1", [item]);
  assert.equal(store.getSnapshot().items[0].quantity, 3);
  const refreshed = createCartStore(scope, () => storage);
  refreshed.load();
  refreshed.clearPurchased("order-1", [item]);
  assert.equal(refreshed.getSnapshot().items[0].quantity, 3);
});
test("confirmation cleanup reads the latest cross-tab bag and remains tenant scoped", () => {
  const storage = memoryStorage();
  const store = createCartStore(scope, () => storage);
  store.update(() => [item]);
  const otherTab = createCartStore(scope, () => storage);
  otherTab.update((items) => addCartItem(items, { ...item, quantity: 1 }));
  store.clearPurchased("order-2", [item]);
  assert.equal(store.getSnapshot().items[0].quantity, 1);
  const otherTenant = createCartStore(
    { ...scope, restaurantId: "r2" },
    () => storage,
  );
  otherTenant.update(() => [item]);
  assert.equal(otherTenant.getSnapshot().items[0].quantity, 2);
});

test("bags cannot be restored across visit generations, even at the same restaurant and table", () => {
  const first = { ...scope, visitKey: "first-visit" },
    next = { ...scope, visitKey: "next-visit" };
  const raw = serializeCart(first, [item]);
  assert.deepEqual(parseCart(raw, first), [
    { ...item, optionIds: [...item.optionIds].sort() },
  ]);
  assert.deepEqual(parseCart(raw, next), []);
  assert.notEqual(cartStorageKey(first), cartStorageKey(next));
});
test("visit cleanup removes previous bags and reviews without affecting other restaurants", () => {
  const visit = { ...scope, visitKey: "new" },
    restaurant = encodeURIComponent(scope.restaurantId);
  const entries = new Map([
    [cartStorageKey(visit), "current"],
    [
      `restaurant-os:submission:v2:${scope.mode}:${restaurant}:new`,
      "current retry",
    ],
    [`restaurant-os:cart:v2:${scope.mode}:${restaurant}:old`, "old bag"],
    [
      `restaurant-os:submission:v2:${scope.mode}:${restaurant}:old`,
      "old private quote",
    ],
    [`restaurant-os:cart:v1:${scope.mode}:${restaurant}`, "legacy bag"],
    [`restaurant-os:submission:v1:${scope.mode}:${restaurant}`, "legacy quote"],
    ["restaurant-os:cart:v2:live:another:new", "another restaurant"],
  ]);
  purgeOtherVisitStorage(
    {
      get length() {
        return entries.size;
      },
      key: (i) => [...entries.keys()][i],
      removeItem: (k) => entries.delete(k),
    },
    visit,
  );
  assert.equal(entries.size, 3);
  assert.equal(entries.get(cartStorageKey(visit)), "current");
  assert.ok(entries.has("restaurant-os:cart:v2:live:another:new"));
});
