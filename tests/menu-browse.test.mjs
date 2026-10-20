import { test } from "node:test";
import assert from "node:assert/strict";
import { browseMenu, menuSelection, menuBrowsePath, productBrowsePath } from "../src/features/menu/browse.ts";
import { demoMenu } from "../src/features/menu/demo-data.ts";

const all = { categoryId: "all", query: "" };
const table = "22222222-2222-4222-8222-222222222222";

test("the complete menu is grouped in restaurant order without duplicating favorites", () => {
  const result = browseMenu(demoMenu, all);
  assert.deepEqual(result.groups.map(group => group.id), demoMenu.categories.filter(c => c.id !== "favorites" && demoMenu.products.some(p => p.categoryId === c.id)).map(c => c.id));
  const ids = result.groups.flatMap(group => group.products.map(p => p.id));
  assert.equal(ids.length, demoMenu.products.length);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(result.count, result.total);
  assert.equal(result.total, demoMenu.products.length);
  assert.equal(result.categories.find(c => c.id === "favorites").count, 3);
});

test("category selection shows only that category; favorites remains an explicit shortcut", () => {
  for (const category of demoMenu.categories) {
    const result = browseMenu(demoMenu, { categoryId: category.id, query: "" });
    assert.ok(result.groups.every(group => group.id === category.id));
    const products = result.groups.flatMap(group => group.products);
    assert.ok(products.every(p => category.id === "favorites" ? p.tags.includes("House favorite") : p.categoryId === category.id));
  }
});

test("search matches names, ingredients and descriptions regardless of case and accents", () => {
  const menu = structuredClone(demoMenu);
  menu.products[0].name = "Açaí Bowl";
  menu.products[0].ingredients = ["Blueberries", "Greek yoghurt"];
  assert.equal(browseMenu(menu, { ...all, query: "  ACAI   blueberries " }).count, 1);
  assert.equal(browseMenu(menu, { ...all, query: "acai missingword" }).count, 0);
  assert.equal(browseMenu(demoMenu, { ...all, query: "hollandaise" }).groups[0].products[0].id, "eggs");
  assert.equal(browseMenu(demoMenu, { ...all, query: "   " }).count, demoMenu.products.length);
});

test("search and categories combine without leaking other categories or menus", () => {
  assert.equal(browseMenu(demoMenu, { categoryId: "drinks", query: "salmon" }).count, 0);
  const restaurantB = { ...demoMenu, id: "another-restaurant", products: [{ ...demoMenu.products[0], name: "Private B dish", description: "Only B", ingredients: [], tags: [] }] };
  assert.equal(browseMenu(demoMenu, { ...all, query: "Private B dish" }).count, 0);
  assert.equal(browseMenu(restaurantB, { ...all, query: "Private B dish" }).count, 1);
  const withOrphan = { ...demoMenu, products: [...demoMenu.products, { ...demoMenu.products[0], id: "orphan", categoryId: "unpublished", name: "Hidden orphan" }] };
  assert.equal(browseMenu(withOrphan, { ...all, query: "Hidden orphan" }).count, 0);
});

test("empty categories and unavailable shortcut targets do not appear in the picker", () => {
  const menu = { ...demoMenu, categories: [...demoMenu.categories, { id: "empty", name: "Empty", description: "" }], products: [] };
  assert.deepEqual(browseMenu(menu, all), { categories: [], groups: [], count: 0, total: 0 });
  assert.deepEqual(menuSelection(menu, { category: "favorites" }), all);
  assert.deepEqual(menuSelection(menu, { category: "empty" }), all);
});

test("URL inputs are bounded and invalid, repeated or removed category values reset safely", () => {
  assert.deepEqual(menuSelection(demoMenu, {}), all);
  assert.deepEqual(menuSelection(demoMenu, { category: ["mains", "drinks"], q: ["salmon"] }), all);
  assert.deepEqual(menuSelection(demoMenu, { category: "missing", q: "salmon" }), { categoryId: "all", query: "salmon" });
  assert.equal(menuSelection(demoMenu, { q: "a".repeat(1000) }).query.length, 120);
  assert.equal(menuSelection(demoMenu, { category: "mains" }).categoryId, "mains");
});

test("product navigation and return preserve filters and the supplied table, with same-origin encoded URLs", () => {
  const selection = { categoryId: "mains", query: "pasta & basil <script>" };
  const product = new URL(productBrowsePath("mesa", "pasta", table, selection), "https://menu.example");
  assert.equal(product.origin, "https://menu.example");
  assert.equal(product.pathname, "/r/mesa/products/pasta");
  assert.equal(product.searchParams.get("table"), table);
  assert.equal(product.searchParams.get("q"), selection.query);
  assert.ok(!product.href.includes("<script>"));
  const restored = menuSelection(demoMenu, Object.fromEntries(product.searchParams));
  assert.deepEqual(restored, selection);
  const back = new URL(menuBrowsePath("mesa", table, restored, "pasta"), product.origin);
  assert.equal(back.pathname, "/r/mesa");
  assert.equal(back.searchParams.get("table"), table);
  assert.equal(back.searchParams.get("category"), "mains");
  assert.equal(back.searchParams.get("q"), selection.query);
  assert.equal(back.hash, "#dish-pasta");
  assert.equal(menuBrowsePath("mesa", undefined, all), "/r/mesa");
  assert.equal(new URL(menuBrowsePath("//evil.example", undefined, selection), product.origin).origin, product.origin);
});

test("browsing does not mutate product prices, options, or the catalog", () => {
  const before = JSON.stringify(demoMenu);
  browseMenu(demoMenu, { categoryId: "favorites", query: "salmon" });
  assert.equal(JSON.stringify(demoMenu), before);
});
