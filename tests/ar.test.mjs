import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  safeModelAsset,
  productVisualization,
  modelDimensions,
  dimensionsMatch,
  arAvailability,
  previewSource,
} from "../src/features/ar/assets.ts";
import { connectViewer } from "../src/features/ar/viewer-controller.ts";
import { demoMenu } from "../src/features/menu/demo-data.ts";
import { createDraftStore, draftKey } from "../src/features/products/draft.ts";
import { mapMenuRows } from "../src/features/menu/repository.ts";
import ts from "typescript";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

const r = "11111111-1111-4111-8111-111111111111",
  p = "44444444-4444-4444-8444-444444444441";
const root = `https://test.supabase.co/storage/v1/object/public/dish-models/${r}/${p}/`;
const asset = {
  src: `${root}dish.glb`,
  iosSrc: `${root}dish.usdz`,
  poster: `${root}dish.webp`,
  alt: "A dish",
  dimensions: [0.22, 0.05, 0.22],
};
test("retry avoids the SDK's rejected-load cache while retaining the exact configured resource", () => {
  assert.equal(previewSource(asset.src, 0), asset.src);
  const retry = new URL(previewSource(asset.src, 1));
  assert.equal(retry.origin, new URL(asset.src).origin);
  assert.equal(retry.pathname, new URL(asset.src).pathname);
  assert.equal(retry.search, "?preview_attempt=1");
  assert.notEqual(previewSource(asset.src, 1), previewSource(asset.src, 2));
  assert.equal(previewSource(asset.src, NaN), asset.src);
});
test("only exact public tenant/product GLB, USDZ and poster paths are accepted", () => {
  for (const [format, file] of [
    ["glb", "dish.glb"],
    ["usdz", "dish.usdz"],
    ["poster", "dish.webp"],
  ]) {
    assert.equal(
      safeModelAsset(root + file, format, r, p, "https://test.supabase.co"),
      root + file,
    );
    assert.equal(
      safeModelAsset(`/models/${r}/${p}/${file}`, format, r, p),
      `/models/${r}/${p}/${file}`,
    );
  }
});
test("unsafe, cross-tenant, signed, encoded, unrelated and unsupported assets are rejected", () => {
  for (const url of [
    null,
    "",
    "javascript:alert(1)",
    "data:model/gltf-binary,test",
    "//evil.com/a.glb",
    root + "a.gltf",
    root + "a.glb?token=secret",
    root + "a.glb#link=evil",
    root + "../a.glb",
    root + "%2e%2e/a.glb",
    root + "a%252egl b",
    root.replace(r, "other") + "a.glb",
    root.replace(p, "other") + "a.glb",
    root.replace("https:", "http:") + "a.glb",
    root.replace("test.supabase.co", "evil.com") + "a.glb",
    root.replace("https://", "https://user:pass@") + "a.glb",
    `/models/${r}/other/a.glb`,
  ])
    assert.equal(
      safeModelAsset(url, "glb", r, p, "https://test.supabase.co"),
      undefined,
      String(url),
    );
});
test("live products without valid assets never acquire a demo model or an AR entry", () => {
  for (const model_glb_url of [null, undefined, "https://evil.com/a.glb"])
    assert.equal(
      productVisualization(
        { id: p, name: "Eggs", model_glb_url },
        r,
        "https://test.supabase.co",
      ),
      undefined,
    );
  const configured = productVisualization(
    {
      id: p,
      name: "Eggs",
      model_glb_url: asset.src,
      model_verified: true,
      model_ar_enabled: true,
      model_usdz_url: "https://evil.com/a.usdz",
      model_dimensions_m: [...asset.dimensions],
    },
    r,
    "https://test.supabase.co",
  );
  assert.equal(configured.src, asset.src);
  assert.equal(configured.iosSrc, undefined);
  assert.equal(configured.development, undefined);
});
test("published menu mapping uses the requested restaurant's assets and optional measured metadata", () => {
  const row = {
    id: p,
    category_id: "c",
    name: "Dish",
    description: "",
    price_minor: 100,
    dietary_tags: [],
    model_glb_url: asset.src,
    model_verified: true,
    model_ar_enabled: true,
    model_dimensions_m: [...asset.dimensions],
  };
  const rows = {
    products: [row],
    categories: [{ id: "c", name: "Mains", description: "" }],
  };
  assert.equal(
    mapMenuRows({ id: r }, rows, "https://test.supabase.co").products[0]
      .visualization.src,
    asset.src,
  );
  assert.equal(
    mapMenuRows({ id: "other" }, rows, "https://test.supabase.co").products[0]
      .visualization,
    undefined,
  );
});
test("AR requires plausible finite geometry, declared matching dimensions and HTTPS capability", () => {
  for (const value of [
    null,
    [],
    [0.2, 0.2],
    [0, 0.1, 0.1],
    [NaN, 0.1, 0.1],
    [Infinity, 0.1, 0.1],
    [2, 0.1, 0.1],
    ["0.2", 0.1, 0.1],
  ])
    assert.equal(modelDimensions(value), undefined);
  assert.ok(dimensionsMatch(asset.dimensions, { x: 0.22, y: 0.05, z: 0.22 }));
  assert.equal(
    dimensionsMatch(asset.dimensions, { x: 2.2, y: 0.5, z: 2.2 }),
    false,
  );
  assert.equal(arAvailability(false, true, true), "https");
  assert.equal(arAvailability(true, true, false), "scale");
  assert.equal(arAvailability(true, false, true), "unsupported");
  assert.equal(arAvailability(true, true, true), "available");
});
class Viewer extends EventTarget {
  attributes = new Map();
  loaded = false;
  canActivateAR = true;
  launches = 0;
  pauses = 0;
  resets = 0;
  setAttribute(k, v) {
    this.attributes.set(k, v);
  }
  removeAttribute(k) {
    this.attributes.delete(k);
  }
  getDimensions() {
    return { x: 0.22, y: 0.05, z: 0.22 };
  }
  async activateAR() {
    this.launches++;
  }
  pause() {
    this.pauses++;
  }
  resetTurntableRotation() {
    this.resets++;
  }
  jumpCameraToGoal() {}
  zoom() {}
}
function event(viewer, name, detail) {
  viewer.dispatchEvent(new CustomEvent(name, { detail }));
}
test("viewer is fixed scale, accessible and never launches AR automatically", () => {
  const v = new Viewer();
  let state;
  const c = connectViewer(v, asset, true, (s) => {
    state = s;
  });
  try {
    assert.equal(v.attributes.get("aria-label"), asset.alt);
    assert.equal(v.attributes.get("ar-scale"), "fixed");
    assert.equal(v.attributes.has("auto-rotate"), false);
    assert.equal(v.attributes.has("ar"), false);
    event(v, "load");
    assert.equal(state.phase, "ready");
    assert.equal(state.ar, "available");
    assert.equal(v.launches, 0);
    c.reset();
    assert.equal(v.resets, 1);
    c.launchAR();
    assert.equal(v.launches, 1);
    c.launchAR();
    assert.equal(v.launches, 1);
  } finally {
    c.dispose();
  }
});
test("failed or wrong-size models cannot launch AR; failures retain a usable retry path", () => {
  const v = new Viewer();
  let state;
  const c = connectViewer(
    v,
    { ...asset, dimensions: [0.1, 0.1, 0.1] },
    true,
    (s) => {
      state = s;
    },
  );
  event(v, "load");
  assert.equal(state.ar, "scale");
  c.launchAR();
  assert.equal(v.launches, 0);
  event(v, "error");
  assert.equal(state.phase, "error");
  assert.equal(v.attributes.has("ar"), false);
  event(v, "load");
  assert.equal(state.phase, "error");
  c.dispose();
});
test("slow loading, timeout and unsupported devices are explicit; detection begins after a slow model loads", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const v = new Viewer();
  v.canActivateAR = false;
  let state;
  const c = connectViewer(v, asset, true, (s) => {
    state = s;
  });
  t.mock.timers.tick(13000);
  assert.equal(state.slow, true);
  event(v, "load");
  t.mock.timers.tick(5000);
  assert.equal(state.ar, "unsupported");
  v.canActivateAR = true;
  t.mock.timers.tick(500);
  assert.equal(state.ar, "available");
  c.dispose();
  const c2 = connectViewer(new Viewer(), asset, true, (s) => {
    state = s;
  });
  t.mock.timers.tick(45000);
  assert.equal(state.phase, "error");
  c2.dispose();
});
test("native launch errors fall back to 3D without claiming successful AR", async () => {
  const v = new Viewer();
  v.activateAR = async () => {
    throw new Error("Permission denied");
  };
  let state;
  const c = connectViewer(v, asset, true, (s) => {
    state = s;
  });
  event(v, "load");
  c.launchAR();
  await new Promise((r) => setImmediate(r));
  assert.equal(state.phase, "ready");
  assert.equal(state.launching, false);
  assert.match(state.guidance, /couldn’t start/);
  event(v, "ar-status", { status: "session-started" });
  assert.match(state.guidance, /flat table/);
  event(v, "ar-status", { status: "failed" });
  assert.match(state.guidance, /3D/);
  c.dispose();
});
test("cleanup detaches all events, stops timers and drops model and AR references", () => {
  const v = new Viewer();
  let calls = 0;
  const c = connectViewer(v, asset, true, () => {
    calls++;
  });
  c.dispose();
  event(v, "load");
  event(v, "progress", { totalProgress: 1 });
  c.launchAR();
  assert.equal(calls, 0);
  assert.equal(v.launches, 0);
  assert.equal(v.pauses, 1);
  for (const k of ["src", "ios-src", "poster", "ar"])
    assert.equal(v.attributes.has(k), false);
});
function storage() {
  const values = new Map();
  return {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
    key: (i) => [...values.keys()][i] ?? null,
    get length() {
      return values.size;
    },
  };
}
const scope = {
  restaurantId: "demo-mesa",
  mode: "demo",
  currency: "EUR",
  visitKey: "visit-a",
};
test("customizations and quantity survive AR/page return without changing the bag", () => {
  const s = storage(),
    product = demoMenu.products[0];
  s.setItem("restaurant-os:cart:unrelated", "untouched");
  const d = createDraftStore(scope, product, () => s),
    off = d.subscribe(() => {});
  d.setQuantity(3);
  d.setOptionIds(() => ["eggs-base-0", "eggs-extra-0"]);
  off();
  const restored = createDraftStore(scope, product, () => s),
    end = restored.subscribe(() => {});
  assert.equal(restored.getSnapshot().quantity, 3);
  assert.deepEqual(restored.getSnapshot().optionIds, [
    "eggs-base-0",
    "eggs-extra-0",
  ]);
  assert.equal(s.getItem("restaurant-os:cart:unrelated"), "untouched");
  end();
});
test("product drafts cannot cross visits, restaurants, data modes or catalog revisions", () => {
  const s = storage(),
    product = demoMenu.products[0];
  const d = createDraftStore(scope, product, () => s);
  const off = d.subscribe(() => {});
  d.setQuantity(3);
  off();
  for (const other of [
    { ...scope, restaurantId: "other" },
    { ...scope, mode: "live" },
    { ...scope, visitKey: "visit-b" },
  ]) {
    const store = createDraftStore(other, product, () => s),
      end = store.subscribe(() => {});
    assert.equal(store.getSnapshot().quantity, 1);
    end();
  }
  assert.equal(s.getItem(draftKey(scope, product.id)), null);
  const changed = createDraftStore(
      scope,
      { ...product, priceMinor: 9999 },
      () => s,
    ),
    end = changed.subscribe(() => {});
  assert.equal(changed.getSnapshot().quantity, 1);
  end();
});
test("blocked or corrupt draft persistence never prevents customization", () => {
  const s = storage(),
    product = demoMenu.products[0];
  s.setItem(draftKey(scope, product.id), "{bad");
  const d = createDraftStore(scope, product, () => s),
    off = d.subscribe(() => {});
  assert.equal(d.getSnapshot().quantity, 1);
  off();
  const blocked = createDraftStore(scope, product, () => {
    throw new Error("Blocked");
  });
  const end = blocked.subscribe(() => {});
  blocked.setQuantity(2);
  assert.equal(blocked.getSnapshot().quantity, 2);
  assert.equal(blocked.getSnapshot().storageError, true);
  end();
});
test("the genuine licensed demo GLB is self-contained, optimized, physically measured and explicitly labelled", async () => {
  const b = await readFile("public/models/demo-mesa/eggs/avocado.glb"),
    report = JSON.parse(
      await readFile("docs/assets/avocado-report.json", "utf8"),
    );
  assert.equal(b.readUInt32LE(0), 0x46546c67);
  assert.equal(b.readUInt32LE(8), b.length);
  assert.equal(createHash("sha256").update(b).digest("hex"), report.sha256);
  assert.ok(b.length < 700000);
  const length = b.readUInt32LE(12),
    j = JSON.parse(b.subarray(20, 20 + length).toString()),
    bin = b.subarray(28 + length);
  assert.ok(j.images.every((i) => i.bufferView !== undefined && !i.uri));
  assert.ok(j.buffers.every((i) => !i.uri));
  const a = j.accessors[j.meshes[0].primitives[0].attributes.POSITION],
    v = j.bufferViews[a.bufferView];
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < a.count; i++)
    for (let k = 0; k < 3; k++) {
      const n = bin.readFloatLE(
        v.byteOffset + (a.byteOffset ?? 0) + i * 12 + k * 4,
      );
      min[k] = Math.min(min[k], n);
      max[k] = Math.max(max[k], n);
    }
  const size = max.map((n, k) => n - min[k]);
  assert.ok(
    dimensionsMatch(demoMenu.products[0].visualization.dimensions, {
      x: size[0],
      y: size[1],
      z: size[2],
    }),
  );
  assert.ok(Math.abs(min[1]) < 0.00001);
  assert.ok(report.triangles < 10000);
  assert.match(
    demoMenu.products[0].visualization.development.label,
    /not this dish/,
  );
  assert.equal(report.license, "CC0-1.0");
});

test("manager-disabled table placement stays disabled on an AR-capable HTTPS device", () => {
  const v = new Viewer();
  let state;
  const c = connectViewer(v, { ...asset, arEnabled: false }, true, (s) => {
    state = s;
  });
  event(v, "load");
  assert.equal(state.phase, "ready");
  assert.equal(state.ar, "disabled");
  assert.equal(v.attributes.has("ar"), false);
  c.launchAR();
  assert.equal(v.launches, 0);
  c.dispose();
});

test("explicit demonstration models are visible without a false physical approval and never expose AR/USDZ", () => {
  const row = {
    id: p,
    name: "Yakitori",
    model_glb_url: asset.src,
    model_usdz_url: asset.iosSrc,
    model_verified: false,
    model_demo_enabled: true,
    model_ar_enabled: true,
    model_dimensions_m: [...asset.dimensions],
  };
  const view = productVisualization(row, r, "https://test.supabase.co");
  assert.equal(view.src, asset.src);
  assert.equal(view.demonstration, true);
  assert.equal(view.arEnabled, false);
  assert.equal(view.iosSrc, undefined);
  assert.match(view.alt, /demonstration.*not a verified/i);
  assert.equal(
    productVisualization(
      { ...row, model_demo_enabled: false },
      r,
      "https://test.supabase.co",
    ),
    undefined,
  );
  assert.equal(
    productVisualization(
      { ...row, model_demo_enabled: "true" },
      r,
      "https://test.supabase.co",
    ),
    undefined,
  );
  assert.equal(
    productVisualization(
      { ...row, model_glb_url: root.replace(r, "other") + "dish.glb" },
      r,
      "https://test.supabase.co",
    ),
    undefined,
  );
});
test("demonstration flag prevents AR even when another caller mistakenly sets arEnabled true", () => {
  const v = new Viewer();
  let state;
  const c = connectViewer(
    v,
    { ...asset, demonstration: true, arEnabled: true },
    true,
    (s) => {
      state = s;
    },
  );
  event(v, "load");
  assert.equal(state.phase, "ready");
  assert.equal(state.ar, "disabled");
  assert.equal(v.attributes.has("ar"), false);
  c.launchAR();
  assert.equal(v.launches, 0);
  c.dispose();
});

test("the customer demonstration notice discloses sample status and avoids a real-portion claim", async () => {
  const source = await readFile(
    "src/features/ar/components/model-demonstration-notice.tsx",
    "utf8",
  );
  const require = createRequire(import.meta.url);
  const output = ts
    .transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
      },
    })
    .outputText.replace(
      '"react/jsx-runtime"',
      JSON.stringify(pathToFileURL(require.resolve("react/jsx-runtime")).href),
    );
  const { ModelDemonstrationNotice } = await import(
    "data:text/javascript;base64," + Buffer.from(output).toString("base64")
  );
  const html = renderToStaticMarkup(ModelDemonstrationNotice());
  assert.match(html, /role="note"/);
  assert.match(html, /3D demonstration/);
  assert.match(html, /not a verified representation/);
  assert.match(html, /real portion size/);
  assert.match(html, /Table placement is disabled/);
});
