import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { customerOrderLabel, progressLabels } from "../src/features/orders/progress.ts";

test("kitchen progress cannot promise a serving time or readiness to a customer", () => {
  for (const status of ["pending", "accepted", "preparing", "ready"]) {
    assert.equal(customerOrderLabel(status), "Order sent");
    assert.equal(progressLabels[status], progressLabels.pending);
    assert.doesNotMatch(progressLabels[status], /ready|prepar|minute|wait time/i);
  }
  assert.equal(customerOrderLabel("served"), "Served");
  assert.equal(customerOrderLabel("cancelled"), "Cancelled");
});

const source = await readFile("src/features/orders/components/order-tracking.tsx", "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const require = createRequire(import.meta.url);
const loaded = { exports: {} };
new Function("require", "module", "exports", output)(
  (id) => id === "../progress" ? { progressLabels } : require(id), loaded, loaded.exports,
);
const receipt = (status, extra = {}) => renderToStaticMarkup(createElement(loaded.exports.OrderTracking, {
  tracking: { value: { status, cancelReason: null }, connection: "live", denied: false, refresh: async () => {}, ...extra },
}));

test("a prepared receipt has no progress dashboard, clock, ready alert or ETA", () => {
  const html = receipt("ready");
  assert.match(html, /Order sent/);
  assert.match(html, /Order sent to the restaurant/);
  assert.match(html, /don’t need to confirm anything else/);
  assert.doesNotMatch(html, /<ol|<time|Order progress|Your order is ready|Preparing|minute|ETA/);
});

test("cancellations remain clear and escaped; reconnecting never falsely confirms readiness", () => {
  const html = receipt("cancelled", { value: { status: "cancelled", cancelReason: "Unavailable <script>bad</script>" } });
  assert.match(html, /Order cancelled/);
  assert.match(html, /Unavailable &lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(receipt("ready", { connection: "offline" }), /Reconnecting to the restaurant/);
});

test("actual service is clearly distinguished from merely sending an order", () => {
  const html = receipt("served");
  assert.match(html, /Order served/);
  assert.match(html, /This order has been served/);
  assert.doesNotMatch(html, /Order confirmed|prepar|minute|ETA/);
});
