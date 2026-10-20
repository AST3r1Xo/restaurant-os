import type { RestaurantMenu } from "./types.ts";
import { customerPath, productPath } from "../../lib/routes.ts";

export type BrowseParams = {
  category?: string | string[];
  q?: string | string[];
};
export type MenuSelection = { categoryId: string; query: string };

export function menuSelection(menu: RestaurantMenu, params: BrowseParams): MenuSelection {
  const available = browseMenu(menu, { categoryId: "all", query: "" }).categories;
  return {
    categoryId:
      typeof params.category === "string" &&
      available.some((category) => category.id === params.category)
        ? params.category
        : "all",
    query: typeof params.q === "string" ? params.q.slice(0, 120) : "",
  };
}

function searchable(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function browseMenu(menu: RestaurantMenu, selection: MenuSelection) {
  const realCategories = menu.categories.filter((category) => category.id !== "favorites");
  const categoryIds = new Set(realCategories.map((category) => category.id));
  const catalog = menu.products.filter((product) => categoryIds.has(product.categoryId));
  const inCategory = (id: string) => catalog.filter((product) =>
    id === "favorites" ? product.tags.includes("House favorite") : product.categoryId === id,
  );
  const categories = menu.categories
    .map((category) => ({ ...category, count: inCategory(category.id).length }))
    .filter((category) => category.count > 0);
  const terms = searchable(selection.query).trim().split(/\s+/).filter(Boolean);
  const visibleCategories = selection.categoryId === "all"
    ? realCategories
    : menu.categories.filter((category) => category.id === selection.categoryId);
  const groups = visibleCategories.map((category) => ({
    ...category,
    products: inCategory(category.id).filter((product) => {
      const text = searchable([product.name, product.description, ...product.ingredients, ...product.tags].join(" "));
      return terms.every((term) => text.includes(term));
    }),
  })).filter((group) => group.products.length > 0);
  return {
    categories,
    groups,
    count: groups.reduce((total, group) => total + group.products.length, 0),
    total: catalog.length,
  };
}

function withSelection(path: string, selection: MenuSelection) {
  const url = new URL(path, "https://restaurant-os.invalid");
  if (selection.categoryId !== "all") url.searchParams.set("category", selection.categoryId);
  if (selection.query) url.searchParams.set("q", selection.query);
  return url.pathname + url.search;
}

export function menuBrowsePath(slug: string, token: string | undefined, selection: MenuSelection, returnToProduct?: string) {
  const path = withSelection(customerPath(slug, "menu", token), selection);
  return returnToProduct ? `${path}#dish-${encodeURIComponent(returnToProduct)}` : path;
}

export function productBrowsePath(slug: string, productId: string, token: string | undefined, selection: MenuSelection) {
  return withSelection(productPath(slug, productId, token), selection);
}
