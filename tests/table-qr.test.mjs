import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import jsQR from "jsqr";
import { PDFDocument } from "pdf-lib";
import { unzipSync } from "fflate";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import ts from "typescript";
import {
  publicQROrigin,
  tableQRUrl,
} from "../src/features/restaurant-operations/qr-origin.ts";
import {
  qrPNG,
  qrPDF,
  qrZIP,
  qrFilename,
} from "../src/features/restaurant-operations/qr-artifacts.ts";
const origin = "https://restaurant.example.com",
  restaurant = { name: "Casa Mesa", slug: "mesa" };
const tables = Array.from({ length: 5 }, (_, i) => ({
  id: randomUUID(),
  label: `Table 0${i + 1}`,
  qr_token: randomUUID(),
  is_active: true,
  updated_at: new Date().toISOString(),
}));
async function decode(bytes) {
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data;
}
test("printable URLs require a public HTTPS origin without path, credentials or local addresses", () => {
  assert.equal(publicQROrigin(origin + "/"), origin);
  for (const value of [
    undefined,
    "",
    "http://example.com",
    "https://localhost",
    "https://localhost.",
    "https://sub.localhost.",
    "https://127.0.0.1",
    "https://[::1]",
    "https://user:secret@example.com",
    "https://a.local",
    "https://app.test",
    "https://app.invalid",
    "https://example.com/path",
    "https://example.com?key=value",
    "https://example.com/#hash",
  ])
    assert.throws(() => publicQROrigin(value), /stable public HTTPS/);
  assert.throws(() => tableQRUrl(origin, "../secret", randomUUID()));
  assert.throws(() => tableQRUrl(origin, "mesa", "bad"));
});
test("all five generated QR PNGs independently decode to their exact tenant and table URLs", async () => {
  const decoded = [];
  for (const t of tables) {
    const png = await qrPNG(origin, restaurant, t);
    const meta = await sharp(png).metadata();
    assert.equal(meta.width, 1024);
    assert.equal(meta.height, 1024);
    const url = await decode(png);
    assert.equal(url, tableQRUrl(origin, "mesa", t.qr_token));
    decoded.push(url);
  }
  assert.equal(new Set(decoded).size, 5);
});
test("ZIP contains five individually readable PNGs with safe unique filenames", async () => {
  const files = unzipSync(await qrZIP(origin, restaurant, tables));
  assert.equal(Object.keys(files).length, 5);
  for (const t of tables)
    assert.equal(
      await decode(files[qrFilename(t.label, t.id) + ".png"]),
      tableQRUrl(origin, "mesa", t.qr_token),
    );
  assert.doesNotMatch(
    qrFilename("../../evil\r\n.png", tables[0].id),
    /[/.\r\n]/,
  );
});
test("printable cards use A4 with six slots per page; single-table and paginated PDFs remain valid", async () => {
  for (const count of [1, 5, 7]) {
    const selected = Array.from({ length: count }, (_, i) => tables[i % 5]);
    const doc = await PDFDocument.load(
      await qrPDF(origin, restaurant, selected),
    );
    assert.equal(doc.getPageCount(), Math.ceil(count / 6));
    assert.ok(Math.abs(doc.getPages()[0].getWidth() - 595.28) < 0.01);
    assert.ok(Math.abs(doc.getPages()[0].getHeight() - 841.89) < 0.01);
  }
  await assert.rejects(qrPDF(origin, restaurant, []));
  await assert.rejects(qrZIP(origin, restaurant, []));
});
test("missing or insecure public origin never produces printable artifacts", async () => {
  for (const value of ["", "http://localhost:3000"]) {
    await assert.rejects(qrPNG(value, restaurant, tables[0]));
    await assert.rejects(qrPDF(value, restaurant, tables));
    await assert.rejects(qrZIP(value, restaurant, tables));
  }
});

test("branded closed presentation includes configured hours and only exposes current-service links when authorized", async () => {
  const require = createRequire(import.meta.url);
  let source = ts.transpileModule(
    await readFile(
      "src/features/menu/components/restaurant-closed.tsx",
      "utf8",
    ),
    {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
      },
    },
  ).outputText;
  // Framework primitives are mocked; the actual restaurant presentation and
  // conditional service links render through React's server renderer.
  const mockImage = `import {createElement} from ${JSON.stringify(pathToFileURL(require.resolve("react")).href)};export default function Image({src,alt,width,height}){return createElement('img',{src,alt,width,height})}`;
  const mockLink = `import {createElement} from ${JSON.stringify(pathToFileURL(require.resolve("react")).href)};export default function Link({href,className,children}){return createElement('a',{href,className},children)}`;
  const data = (v) =>
    "data:text/javascript;base64," + Buffer.from(v).toString("base64");
  for (const [from, to] of [
    [
      "react/jsx-runtime",
      pathToFileURL(require.resolve("react/jsx-runtime")).href,
    ],
    ["lucide-react", pathToFileURL(require.resolve("lucide-react")).href],
    ["@/lib/routes", new URL("../src/lib/routes.ts", import.meta.url).href],
    ["next/image", data(mockImage)],
    ["next/link", data(mockLink)],
  ])
    source = source.replace(JSON.stringify(from), JSON.stringify(to));
  const { RestaurantClosed } = await import(data(source));
  const context = {
    mode: "live",
    restaurant: {
      id: randomUUID(),
      slug: "mesa",
      name: "Casa Mesa",
      isAcceptingOrders: false,
      openingHours: "Tuesday 19:00-23:00",
      currency: "EUR",
    },
    table: {
      status: "valid",
      token: tables[0].qr_token,
      label: "Table 01",
      visitKey: randomUUID(),
    },
  };
  const closed = renderToStaticMarkup(
    createElement(RestaurantClosed, { context }),
  );
  assert.match(closed, /Currently closed/);
  assert.match(closed, /Casa Mesa/);
  assert.match(closed, /Tuesday 19:00-23:00/);
  assert.match(closed, /Check opening status/);
  assert.doesNotMatch(closed, /\/orders\?|\/bill\?|Place Order|404/);
  const active = renderToStaticMarkup(
    createElement(RestaurantClosed, { context, activeVisit: true }),
  );
  assert.match(active, /Current orders/);
  assert.match(active, /Table bill/);
  assert.match(active, /\/r\/mesa\/orders\?table=/);
  assert.doesNotMatch(active, /Place Order/);
  const noHours = renderToStaticMarkup(
    createElement(RestaurantClosed, {
      context: {
        ...context,
        restaurant: { ...context.restaurant, openingHours: undefined },
      },
    }),
  );
  assert.doesNotMatch(noHours, /Opening hours/);
});
