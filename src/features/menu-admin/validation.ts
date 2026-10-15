import type { ProductDefinition } from "./types";
export const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
export function priceMinor(value: string) {
  if (!/^\d{1,5}([.,]\d{1,2})?$/.test(value.trim()))
    throw new Error("Enter a price with up to two decimal places.");
  const [whole, fraction = ""] = value.trim().replace(",", ".").split(".");
  const n = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (n > 1000000) throw new Error("Prices must be between 0 and 10,000.");
  return n;
}
const text = (v: unknown, max: number, required = false) =>
  typeof v === "string" &&
  v.length <= max &&
  (!required || v.trim().length > 0);
const money = (v: unknown) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 1000000;
const list = (v: unknown) =>
  Array.isArray(v) && v.length <= 40 && v.every((s) => text(s, 120, true));
export function validateProduct(v: ProductDefinition) {
  if (
    !v ||
    !text(v.name, 160, true) ||
    !text(v.description, 4000) ||
    !uuid(v.category_id) ||
    !money(v.price_minor) ||
    !["draft", "published", "archived"].includes(v.status) ||
    typeof v.is_available !== "boolean" ||
    ![v.ingredients, v.allergens, v.dietary_tags].every(list) ||
    ![
      v.image_asset_id,
      v.model_asset_id,
      v.model_usdz_asset_id,
      v.model_poster_asset_id,
    ].every((id) => id === null || uuid(id)) ||
    typeof v.model_verified !== "boolean" ||
    typeof v.model_ar_enabled !== "boolean" ||
    !Array.isArray(v.groups) ||
    v.groups.length > 10
  )
    throw new Error(
      "Check the dish name, price, category and media selection.",
    );
  if (v.model_ar_enabled && !v.model_verified)
    throw new Error("Review the model before enabling table placement.");
  if (
    v.model_verified &&
    (!v.model_asset_id ||
      !v.review?.confirmed ||
      !text(v.review.license, 1000, true) ||
      !text(v.review.provenance, 2000, true) ||
      !text(v.review.measurement_notes, 2000, true))
  )
    throw new Error(
      "Confirm the model rights, provenance and measured physical scale.",
    );
  const ids = new Set<string>();
  for (const g of v.groups) {
    if (
      !uuid(g.id) ||
      ids.has(g.id) ||
      !text(g.name, 120, true) ||
      !text(g.description, 1000) ||
      !["single", "multiple"].includes(g.selection_type) ||
      !Number.isInteger(g.min_selections) ||
      !Number.isInteger(g.max_selections) ||
      g.min_selections < 0 ||
      g.max_selections < 1 ||
      g.max_selections > 20 ||
      g.min_selections > g.max_selections ||
      (g.selection_type === "single" && g.max_selections !== 1) ||
      typeof g.is_active !== "boolean" ||
      !Array.isArray(g.options) ||
      g.options.length > 20
    )
      throw new Error(
        "Check customization names and minimum / maximum choices.",
      );
    ids.add(g.id);
    if (
      g.is_active &&
      g.options.filter((o) => o.is_available).length < g.min_selections
    )
      throw new Error(
        "A required customization needs enough available choices.",
      );
    const names = new Set<string>();
    for (const o of g.options) {
      if (
        !uuid(o.id) ||
        ids.has(o.id) ||
        !text(o.name, 120, true) ||
        names.has(o.name.trim()) ||
        !money(o.price_adjustment_minor) ||
        typeof o.is_available !== "boolean"
      )
        throw new Error("Check customization choices, names and supplements.");
      ids.add(o.id);
      names.add(o.name.trim());
    }
  }
  if (new Set(v.groups.map((g) => g.name.trim())).size !== v.groups.length)
    throw new Error("Give each customization group a different name.");
  return v;
}
