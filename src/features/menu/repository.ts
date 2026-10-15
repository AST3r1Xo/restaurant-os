import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { RestaurantMenu, TableContext } from "./types";
import { normalizeTableToken } from "../../lib/routes.ts";
import { productVisualization } from "../ar/assets.ts";

type Client = SupabaseClient<Database>;
export type Restaurant = Omit<
  Database["public"]["Tables"]["restaurants"]["Row"],
  "logo_asset_id" | "cover_asset_id"
>;

function fail(error: { code?: string } | null, operation: string) {
  if (error)
    throw new Error(
      `Unable to load ${operation} (${error.code || "API_ERROR"}).`,
    );
}

export async function fetchPublishedRestaurant(client: Client, slug: string) {
  const { data, error } = await client
    .from("restaurants")
    .select(
      "id,slug,name,description,cover_image_url,currency,logo_url,timezone,is_published,is_accepting_orders,created_at,updated_at",
    )
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle();
  fail(error, "restaurant");
  return data;
}

export async function fetchMenuRows(client: Client, restaurantId: string) {
  const results = await Promise.all([
    client
      .from("menu_categories")
      .select("id,name,description,sort_order")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .order("sort_order")
      .order("id"),
    client
      .from("products")
      .select(
        "id,category_id,name,description,price_minor,image_url,dietary_tags,ingredients,allergens,sort_order,model_glb_url,model_usdz_url,model_poster_url,model_dimensions_m,model_verified,model_ar_enabled",
      )
      .eq("restaurant_id", restaurantId)
      .eq("is_available", true)
      .eq("is_published", true)
      .is("archived_at", null)
      .order("sort_order")
      .order("id"),
  ]);
  fail(results[0].error, "menu categories");
  fail(results[1].error, "menu products");
  const categories = results[0].data ?? [];
  const ids = new Set(categories.map((category) => category.id));
  return {
    categories,
    products: (results[1].data ?? []).filter((product) =>
      ids.has(product.category_id),
    ),
  };
}

export async function fetchTableContext(
  client: Client,
  slug: string,
  token: string | null,
): Promise<TableContext> {
  if (token === null) return { status: "missing" };
  if (token === "invalid") return { status: "invalid" };
  const { data, error } = await client.rpc("resolve_table_visit", {
    restaurant_slug: slug,
    table_token: token,
  });
  fail(error, "table context");
  if (
    data?.length === 1 &&
    (normalizeTableToken(data[0].visit_key) !== data[0].visit_key ||
      !data[0].visit_key)
  )
    throw new Error(
      "Unable to verify the current dining visit. Please refresh the table QR.",
    );
  return data?.length === 1
    ? {
        status: "valid",
        label: data[0].table_label,
        token,
        visitKey: data[0].visit_key,
      }
    : { status: "invalid" };
}

export function safeMenuImage(
  value: string | null,
  supabaseUrl: string,
): string | undefined {
  if (!value) return undefined;
  if (
    /^\/images\/[a-zA-Z0-9_./-]+\.(jpg|jpeg|png|webp|avif)$/i.test(value) &&
    !value.includes("..")
  )
    return value;
  try {
    const url = new URL(value);
    const host = new URL(supabaseUrl).hostname;
    if (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (url.hostname === "images.unsplash.com" ||
        (url.hostname === host &&
          url.pathname.startsWith("/storage/v1/object/public/")))
    )
      return value;
  } catch {
    /* Missing or unsupported assets use a visible placeholder. */
  }
  return undefined;
}

const tagLabels: Record<string, string> = {
  "house-favorite": "House favorite",
  vegetarian: "Vegetarian",
  "plant-based": "Plant based",
  "chef-selection": "Chef’s selection",
};

export function mapRestaurant(
  restaurant: Restaurant,
  url: string,
): Omit<RestaurantMenu, "categories" | "products"> {
  return {
    id: restaurant.id,
    slug: restaurant.slug,
    name: restaurant.name,
    currency: restaurant.currency,
    isAcceptingOrders: restaurant.is_accepting_orders,
    description: restaurant.description,
    coverImage: safeMenuImage(restaurant.cover_image_url, url),
  };
}

export function mapMenuRows(
  restaurant: Restaurant,
  rows: Awaited<ReturnType<typeof fetchMenuRows>>,
  url: string,
): RestaurantMenu {
  const products = rows.products.map((product) => ({
    id: product.id,
    categoryId: product.category_id,
    name: product.name,
    description: product.description,
    priceMinor: product.price_minor,
    image: safeMenuImage(product.image_url, url),
    imageAlt: product.name,
    tags: product.dietary_tags.map(
      (tag) => tagLabels[tag] ?? tag.replace(/-/g, " "),
    ),
    ingredients: product.ingredients ?? [],
    allergens: product.allergens ?? [],
    modifierGroups: [],
    visualization: productVisualization(product, restaurant.id, url),
  }));
  const categories = rows.categories.map(({ id, name, description }) => ({
    id,
    name,
    description,
  }));
  if (products.some((product) => product.tags.includes("House favorite"))) {
    categories.unshift({
      id: "favorites",
      name: "House favorites",
      description: "The dishes we come back to. And think you will, too.",
    });
  }
  return { ...mapRestaurant(restaurant, url), categories, products };
}

export async function fetchModifierRows(client: Client, restaurantId: string) {
  const [groups, options] = await Promise.all([
    client
      .from("product_modifier_groups")
      .select(
        "id,product_id,name,description,selection_type,min_selections,max_selections,sort_order",
      )
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .order("sort_order")
      .order("id"),
    client
      .from("modifier_options")
      .select("id,group_id,name,price_adjustment_minor,sort_order")
      .eq("restaurant_id", restaurantId)
      .eq("is_available", true)
      .order("sort_order")
      .order("id"),
  ]);
  fail(groups.error, "customization groups");
  fail(options.error, "customization options");
  return { groups: groups.data ?? [], options: options.data ?? [] };
}

export function attachModifiers(
  menu: RestaurantMenu,
  rows: Awaited<ReturnType<typeof fetchModifierRows>>,
): RestaurantMenu {
  return {
    ...menu,
    products: menu.products.map((product) => ({
      ...product,
      modifierGroups: rows.groups
        .filter((group) => group.product_id === product.id)
        .map((group) => ({
          id: group.id,
          name: group.name,
          description: group.description,
          selectionType: group.selection_type as "single" | "multiple",
          minSelections: group.min_selections,
          maxSelections: group.max_selections,
          options: rows.options
            .filter((option) => option.group_id === group.id)
            .map((option) => ({
              id: option.id,
              name: option.name,
              priceAdjustmentMinor: option.price_adjustment_minor,
            })),
        })),
    })),
  };
}
