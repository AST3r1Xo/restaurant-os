import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import {
  validReportDay,
  parseReportSelection,
  shiftReportDay,
  reportHref,
  decodeDailyReport,
} from "../src/features/reports/model.ts";
import { demoDailyReport } from "../src/features/reports/demo.ts";
import { fetchDailyReport } from "../src/features/reports/repository.ts";
import { formatMoney } from "../src/lib/format.ts";
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const r = id(1);
function fixture() {
  return {
    restaurantId: r,
    day: "2026-10-20",
    today: "2026-10-20",
    timezone: "Europe/Lisbon",
    currency: "EUR",
    currencies: ["EUR"],
    fetchedAt: "2026-10-20T12:00:00Z",
    totals: {
      orderCount: 1,
      confirmedCount: 1,
      pendingCount: 0,
      cancelledCount: 0,
      servedCount: 1,
      confirmedMinor: 2000,
      pendingMinor: 0,
      cancelledMinor: 0,
      dishCount: 2,
    },
    products: [
      {
        productId: id(2),
        name: "Historical dish",
        quantity: 2,
        orderCount: 1,
        totalMinor: 2000,
      },
    ],
    orders: [
      {
        id: id(3),
        reference: "ORDER123",
        restaurantId: r,
        tableLabel: "Table 04",
        status: "served",
        currency: "EUR",
        totalMinor: 2000,
        createdAt: "2026-10-20T10:00:00Z",
        updatedAt: "2026-10-20T10:30:00Z",
        notes: "",
        cancelReason: null,
        items: [
          {
            id: id(4),
            name: "Historical dish",
            quantity: 2,
            unitPriceMinor: 1000,
            lineTotalMinor: 2000,
            options: [],
            notes: "Sauce aside <script>alert(1)</script>",
          },
        ],
      },
    ],
    nextCursor: null,
  };
}
test("report dates validate actual calendar days and repeated query parameters cannot bypass parsing", () => {
  for (const day of ["2026-10-20", "2024-02-29", "2100-12-31"])
    assert.ok(validReportDay(day));
  for (const date of [
    "2026-02-29",
    "2100-02-29",
    "2026-04-31",
    "2026-1-01",
    "2026-13-01",
    "1999-12-31",
    "2026-10-20T00:00:00Z",
    ["2026-10-20"],
  ]) {
    assert.equal(validReportDay(date), false);
    assert.throws(() => parseReportSelection({ date }), /REPORT_INVALID/);
  }
  for (const query of [
    { currency: ["EUR"] },
    { currency: "ABC" },
    { before: [id(3)] },
    { before: "other" },
  ])
    assert.throws(() => parseReportSelection(query));
});
test("day navigation crosses month/leap/year boundaries and retains only explicit safe report parameters", () => {
  assert.equal(shiftReportDay("2024-03-01", -1), "2024-02-29");
  assert.equal(shiftReportDay("2026-12-31", 1), "2027-01-01");
  assert.equal(shiftReportDay("2026-10-25", 1), "2026-10-26");
  assert.equal(
    reportHref({ day: "2026-10-20", currency: "EUR", before: id(3) }),
    `/admin/history?date=2026-10-20&currency=EUR&before=${id(3)}`,
  );
  assert.equal(reportHref({}), "/admin/history");
});
test("daily report decoder rejects wrong tenants, inconsistent totals, unsafe arithmetic and mixed currency pages", () => {
  assert.equal(decodeDailyReport(fixture(), r).totals.confirmedMinor, 2000);
  const mutations = [
    (v) => (v.restaurantId = id(9)),
    (v) => (v.day = "2026-02-29"),
    (v) => (v.timezone = "bad/zone"),
    (v) => (v.totals.orderCount = 2),
    (v) => (v.totals.confirmedMinor = Number.MAX_SAFE_INTEGER + 1),
    (v) => (v.totals.servedCount = 2),
    (v) => (v.products[0].quantity = 3),
    (v) => (v.products[0].productId = "no"),
    (v) => v.products.push(v.products[0]),
    (v) => (v.orders[0].currency = "USD"),
    (v) => (v.orders[0].restaurantId = id(9)),
    (v) => (v.nextCursor = id(9)),
    (v) => (v.orders[0].items[0].lineTotalMinor = 1),
    (v) => v.orders.push(v.orders[0]),
    (v) => (v.currencies = ["EUR", "EUR"]),
  ];
  for (const mutate of mutations) {
    const v = fixture();
    mutate(v);
    assert.throws(() => decodeDailyReport(v, r));
  }
});
test("repository requests only the verified target and explicit report filters; live failures never return fixtures", async () => {
  const calls = [],
    client = {
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: fixture(), error: null };
      },
    };
  await fetchDailyReport(client, r, { day: "2026-10-20", currency: "EUR" });
  assert.deepEqual(calls[0], {
    name: "get_daily_restaurant_report",
    args: {
      target_restaurant: r,
      report_day: "2026-10-20",
      report_currency: "EUR",
    },
  });
  await assert.rejects(
    fetchDailyReport(
      {
        rpc: async () => ({
          error: { code: "P0001", message: "REPORT_INVALID" },
        }),
      },
      r,
      {},
    ),
    /REPORT_INVALID/,
  );
  await assert.rejects(
    fetchDailyReport(
      {
        rpc: async () => ({
          error: { code: "500", message: "Internal secret details" },
        }),
      },
      r,
      {},
    ),
    /REPORT_UNAVAILABLE/,
  );
});
test("explicit demo shows coherent sample history for the selected day without database operations", () => {
  const value = demoDailyReport("2026-10-19");
  assert.equal(value.day, "2026-10-19");
  assert.equal(value.orders.length, 24);
  const confirmed = value.orders.filter((o) =>
    ["ready", "served"].includes(o.status),
  );
  assert.equal(
    value.totals.confirmedMinor,
    confirmed.reduce((s, o) => s + o.totalMinor, 0),
  );
  assert.equal(
    value.totals.dishCount,
    value.products.reduce((s, p) => s + p.quantity, 0),
  );
  assert.equal(
    value.products.reduce((s, p) => s + p.totalMinor, 0),
    value.totals.confirmedMinor,
  );
  assert.ok(
    value.orders.every(
      (o) =>
        o.reference.startsWith("SAMPLE") && o.createdAt.startsWith(value.day),
    ),
  );
});

const require = createRequire(import.meta.url);
async function component(path, dependencies) {
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
const { OrderSummary } = await component(
  "src/features/orders/components/order-summary.tsx",
  { "@/lib/format": { formatMoney } },
);
const { DailyDashboard } = await component(
  "src/features/reports/components/daily-dashboard.tsx",
  {
    "@/lib/format": { formatMoney },
    "@/features/orders/components/order-summary": { OrderSummary },
    "../model": { reportHref, shiftReportDay },
    "./refresh-report": {
      RefreshReport: () => createElement("button", null, "Refresh day"),
    },
  },
);
test("dashboard renders an accessible unit chart, itemized historical receipts and escaped private notes", () => {
  const html = renderToStaticMarkup(
    createElement(DailyDashboard, { report: fixture() }),
  );
  for (const text of [
    "Confirmed order value",
    "Dishes ranked by confirmed quantity",
    "Table 04",
    "ORDER123",
    "Historical dish",
    "Special request",
  ]) {
    assert.ok(html.includes(text), text);
  }
  assert.match(html, /type="date"/);
  assert.match(html, /aria-label="Previous day"/);
  assert.match(html, /<details/);
  assert.match(html, /Sauce aside &lt;script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /not verified takings or a tax invoice/);
  assert.match(html, /Refresh day/);
});
test("empty history offers a clear date recovery and no chart that implies dishes were ordered", () => {
  const value = fixture();
  value.orders = [];
  value.products = [];
  for (const key of Object.keys(value.totals)) value.totals[key] = 0;
  const html = renderToStaticMarkup(
    createElement(DailyDashboard, { report: value }),
  );
  assert.match(html, /No orders recorded for this day/);
  assert.match(html, /No confirmed dishes/);
  assert.doesNotMatch(html, /aria-label="Dishes ranked by confirmed quantity"/);
});
test("report paging links preserve day and currency and sample views stay explicitly identified", () => {
  const value = fixture();
  value.nextCursor = id(3);
  const html = renderToStaticMarkup(
    createElement(DailyDashboard, { report: value, paginated: true }),
  );
  assert.match(html, /date=2026-10-20&amp;currency=EUR&amp;before=/);
  assert.match(html, /Back to latest orders/);
  const demo = renderToStaticMarkup(
    createElement(DailyDashboard, { report: demoDailyReport(), demo: true }),
  );
  assert.match(demo, /Sample data/);
  assert.doesNotMatch(demo, /Refresh day/);
});
