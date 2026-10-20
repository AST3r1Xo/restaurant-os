import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as cartModel from "../src/features/cart/model.ts";
import * as persistence from "../src/features/cart/persistence.ts";
import * as submission from "../src/features/orders/submission-persistence.ts";
import * as routes from "../src/lib/routes.ts";
import { formatMoney } from "../src/lib/format.ts";
import { reviewNeedsAcceptance } from "../src/features/orders/review-comparison.ts";
import { progressLabels } from "../src/features/orders/progress.ts";

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const product = {
  id: id(1),
  name: "Test dish",
  categoryId: id(2),
  description: "",
  imageAlt: "Test dish",
  priceMinor: 1200,
  tags: [],
  ingredients: [],
  allergens: [],
  modifierGroups: [
    {
      id: id(3),
      name: "Extras",
      selectionType: "multiple",
      minSelections: 0,
      maxSelections: 1,
      options: [{ id: id(4), name: "Avocado", priceAdjustmentMinor: 150 }],
    },
  ],
};
const items = [
  {
    productId: product.id,
    optionIds: [id(4)],
    quantity: 2,
    notes: "Sauce on the side",
  },
];
const lines = cartModel.resolveCart(items, [product]);
const quote = {
  restaurant: { id: id(5), name: "Casa Mesa", slug: "mesa" },
  table: { label: "Table 04" },
  currency: "EUR",
  reviewId: id(6),
  expiresAt: "2099-01-01T00:00:00Z",
  totalMinor: 2700,
  items: [
    {
      productId: product.id,
      productName: product.name,
      quantity: 2,
      basePriceMinor: 1200,
      unitPriceMinor: 1350,
      lineTotalMinor: 2700,
      notes: items[0].notes,
      options: [
        {
          id: id(4),
          groupId: id(3),
          groupName: "Extras",
          name: "Avocado",
          priceAdjustmentMinor: 150,
        },
      ],
    },
  ],
};
test("normal fresh review needs no additional confirmation when the displayed bag matches", () => {
  assert.equal(reviewNeedsAcceptance(quote, lines, 2700), false);
  const edited = [{ ...items[0], quantity: 3 }],
    updated = structuredClone(quote);
  updated.items[0].quantity = 3;
  updated.items[0].lineTotalMinor = 4050;
  updated.totalMinor = 4050;
  assert.equal(
    reviewNeedsAcceptance(
      updated,
      cartModel.resolveCart(edited, [product]),
      4050,
    ),
    false,
  );
});
test("changed price, product name, option definition or intent cannot silently receive acceptance", () => {
  const edits = [
    (q) => {
      q.totalMinor = 2900;
      q.items[0].unitPriceMinor = 1450;
      q.items[0].lineTotalMinor = 2900;
    },
    (q) => {
      q.items[0].productName = "New recipe";
    },
    (q) => {
      q.items[0].options[0].name = "Other topping";
    },
    (q) => {
      q.items[0].options[0].groupName = "New group";
    },
    (q) => {
      q.items[0].notes = "No sauce";
    },
    (q) => {
      q.items[0].quantity = 3;
    },
    (q) => {
      q.items = [];
    },
  ];
  for (const edit of edits) {
    const q = structuredClone(quote);
    edit(q);
    assert.equal(reviewNeedsAcceptance(q, lines, 2700), true);
  }
  assert.equal(
    reviewNeedsAcceptance(quote, [{ ...lines[0], error: "Unavailable" }], 2700),
    true,
  );
});

const require = createRequire(import.meta.url);
async function component(path, dependencies = {}) {
  const source = await readFile(path, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)(
    (name) => dependencies[name] ?? require(name),
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}
const render = (Component, props) =>
  renderToStaticMarkup(createElement(Component, props));
const { ProductAddedActions } = await component(
  "src/features/products/components/product-added-actions.tsx",
);
const { ConfirmationNextSteps } = await component(
  "src/features/orders/components/confirmation-next-steps.tsx",
  { "@/lib/routes": routes },
);
test("adding a dish explicitly means unsent bag, with safe menu and bag choices preserving QR/search", () => {
  const html = render(ProductAddedActions, {
    menuHref: `/r/mesa?table=${id(9)}&q=burger`,
    bagHref: routes.customerPath("mesa", "cart", id(9)),
    saved: true,
  });
  assert.match(html, /Added to your bag/);
  assert.match(html, /Not sent yet/);
  assert.match(html, /stays saved while you browse/);
  assert.match(html, /Add more dishes/);
  assert.match(html, /View bag/);
  assert.match(html, /q=burger/);
  assert.doesNotMatch(html, /Order sent|Order confirmed|\/review/);
});
test("a storage failure never claims a durable bag or encourages navigation that would lose it", () => {
  const html = render(ProductAddedActions, {
    menuHref: "/r/mesa",
    bagHref: "/r/mesa/cart",
    saved: false,
  });
  assert.match(html, /couldn’t save your bag/);
  assert.match(html, /Keep this page open/);
  assert.doesNotMatch(html, /stays saved|<a /);
});
test("confirmed next steps reassure browsing cannot change the sent order and keep table context", () => {
  const html = render(ConfirmationNextSteps, {
    slug: "mesa",
    tableToken: id(9),
    cancelled: false,
    menuAvailable: true,
  });
  assert.match(html, /saved with the restaurant/);
  assert.match(html, /won’t change it/);
  assert.match(html, /Order more/);
  assert.match(html, /View sent orders/);
  assert.match(html, new RegExp(`/r/mesa\\?table=${id(9)}`));
  assert.doesNotMatch(html, /Back to menu|Confirm|\/review/);
});
test("cancelled orders and unavailable menus do not offer misleading success or unavailable menu actions", () => {
  const cancelled = render(ConfirmationNextSteps, {
    slug: "mesa",
    cancelled: true,
    menuAvailable: true,
  });
  assert.match(cancelled, /Choose another dish/);
  assert.doesNotMatch(cancelled, /saved with the restaurant|won’t change it/);
  const unavailable = render(ConfirmationNextSteps, {
    slug: "mesa",
    cancelled: false,
    menuAvailable: false,
  });
  assert.doesNotMatch(unavailable, /Order more/);
  assert.match(unavailable, /View sent orders/);
});

let activeCart = {
  items,
  lines,
  ready: true,
  menu: {
    ...quote.restaurant,
    products: [product],
    currency: "EUR",
    isAcceptingOrders: true,
  },
  context: {
    mode: "demo",
    table: {
      status: "valid",
      token: id(9),
      visitKey: id(10),
      label: "Table 04",
    },
  },
  subtotalMinor: 2700,
  hasInvalidItems: false,
  storageError: false,
  setQuantity() {},
  setNotes() {},
  remove() {},
  clearPurchased() {},
};
const cartDependency = { useCart: () => activeCart };
const { QuantityControl } = await component(
  "src/components/quantity-control.tsx",
);
const { EmptyState } = await component("src/components/empty-state.tsx");
const { NextStep } = await component("src/components/next-step.tsx");
const { actionClass } = await component("src/components/action-button.tsx");
const { OrderSummary } = await component(
  "src/features/orders/components/order-summary.tsx",
  { "@/lib/format": { formatMoney } },
);
const { CartItems } = await component(
  "src/features/cart/components/cart-items.tsx",
  {
    "./cart-provider": cartDependency,
    "@/components/quantity-control": { QuantityControl },
    "@/lib/routes": routes,
    "@/lib/format": { formatMoney },
    "../special-request": { MAX_SPECIAL_REQUEST_LENGTH: 300 },
    "../model": cartModel,
  },
);
const forbidden = () => {
  throw new Error("Rendering must never submit or recover an order");
};
const { OrderReviewContent } = await component(
  "src/features/orders/components/order-review.tsx",
  {
    "next/navigation": {
      useRouter: () => ({ replace: forbidden, refresh: forbidden }),
    },
    "@/features/cart/components/cart-provider": cartDependency,
    "@/features/cart/components/cart-items": { CartItems },
    "@/features/cart/model": cartModel,
    "@/features/cart/persistence": persistence,
    "@/components/empty-state": { EmptyState },
    "@/components/next-step": { NextStep },
    "@/components/action-button": { actionClass },
    "@/lib/routes": routes,
    "@/lib/format": { formatMoney },
    "../actions": {
      reviewOrderAction: forbidden,
      recoverOrderAction: forbidden,
      submitOrderAction: forbidden,
    },
    "../submission-persistence": submission,
    "../review-comparison": { reviewNeedsAcceptance },
    "./order-summary": { OrderSummary },
    "./confirmation-next-steps": { ConfirmationNextSteps },
  },
);
const { CartPageContent } = await component(
  "src/features/cart/components/cart-page.tsx",
  { "@/features/orders/components/order-review": { OrderReviewContent } },
);
test("the bag itself contains editing and order submission, without a review-page navigation step", () => {
  const html = render(CartPageContent);
  for (const text of [
    "Your bag",
    "Not sent yet",
    "Place Order",
    "Special request",
    "Remove",
    "Increase quantity of Test dish",
  ])
    assert.ok(html.includes(text), text);
  assert.match(html, /Demo preview/);
  assert.doesNotMatch(html, /href="[^\"]*\/review/);
});
test("a changed quote updates prices/options in the editable row without duplicating the product", () => {
  const updated = structuredClone(quote);
  updated.items[0].basePriceMinor = 1300;
  updated.items[0].unitPriceMinor = 1450;
  updated.items[0].lineTotalMinor = 2900;
  updated.totalMinor = 2900;
  const html = render(CartItems, { review: updated });
  assert.match(html, /€29\.00/);
  assert.match(html, /€14\.50/);
  assert.doesNotMatch(html, /€27\.00/);
  assert.equal((html.match(/<article/g) ?? []).length, 1);
  assert.match(html, /Increase quantity/);
});
test("empty bag and unavailable dishes keep an actionable recovery rather than a confirmation maze", () => {
  const previous = activeCart;
  try {
    activeCart = { ...previous, items: [], lines: [], subtotalMinor: 0 };
    const empty = render(CartPageContent);
    assert.match(empty, /Your bag is empty/);
    assert.match(empty, /Explore the menu/);
    activeCart = {
      ...previous,
      hasInvalidItems: true,
      lines: [{ ...lines[0], error: "This dish is no longer available." }],
    };
    const invalid = render(CartPageContent);
    assert.match(invalid, /Update or remove the highlighted dishes/);
    assert.match(invalid, /Choose again/);
  } finally {
    activeCart = previous;
  }
});

let tracking = {
  value: { status: "pending" },
  privateAvailable: true,
  denied: false,
  connection: "live",
  refresh: async () => {},
};
const { OrderTracking } = await component(
  "src/features/orders/components/order-tracking.tsx",
  { "../progress": { progressLabels } },
);
const { OrderConfirmation } = await component(
  "src/features/orders/components/order-confirmation.tsx",
  {
    "@/features/realtime/use-realtime-snapshot": {
      useRealtimeSnapshot: () => tracking,
    },
    "../progress-actions": { guestProgressAction: forbidden },
    "./order-tracking": { OrderTracking },
    "@/lib/routes": routes,
    "@/features/cart/model": cartModel,
    "./order-summary": { OrderSummary },
    "./confirmation-cleanup": { ConfirmationCleanup: () => null },
    "./confirmation-next-steps": { ConfirmationNextSteps },
  },
);
const order = {
  ...quote,
  id: id(11),
  reference: "CONFIRMED-ONLY",
  status: "pending",
  createdAt: "2026-10-20T12:00:00Z",
  subtotalMinor: 2700,
};
test("post-send actions appear immediately with a clear final success, ahead of receipt details", () => {
  const html = render(OrderConfirmation, { order, tableToken: id(9) });
  assert.match(html, /Order sent/);
  assert.match(html, /don’t need to confirm anything else/);
  assert.ok(
    html.indexOf("Order more") <
      html.indexOf('aria-label="Confirmed order items"'),
  );
  assert.doesNotMatch(html, /Back to menu/);
});
test("visit revalidation/closure still hides receipts and all reassuring success controls", () => {
  const previous = tracking;
  try {
    for (const denied of [false, true]) {
      tracking = { ...previous, denied, privateAvailable: false };
      const html = render(OrderConfirmation, { order });
      assert.doesNotMatch(
        html,
        /CONFIRMED-ONLY|Order more|saved with the restaurant|Sauce on the side/,
      );
    }
  } finally {
    tracking = previous;
  }
});
