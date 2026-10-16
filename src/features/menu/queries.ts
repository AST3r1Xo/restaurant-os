import "server-only";
import { cache } from "react";
import { demoMenu } from "./demo-data";
import { demoTableContext, normalizeTableToken } from "./table-context";
import {
  fetchMenuRows,
  fetchPublishedRestaurant,
  fetchTableContext,
  mapMenuRows,
  mapRestaurant,
  fetchModifierRows,
  attachModifiers,
} from "./repository";
import { DEMO_RESTAURANT_SLUG } from "@/lib/routes";
import { getDataMode, requireSupabaseConfig } from "@/lib/env";
import { createPublicClient } from "@/lib/supabase/public";
import type { CustomerContext } from "./types";

// Deduplicate only within one render; table validity is refreshed each request.
const getLiveRestaurant = cache((slug: string) =>
  fetchPublishedRestaurant(createPublicClient(), slug),
);

export const getRestaurant = cache(async (slug: string) => {
  if (getDataMode() === "demo")
    return slug === DEMO_RESTAURANT_SLUG ? demoMenu : null;
  const row = await getLiveRestaurant(slug);
  return row ? mapRestaurant(row, requireSupabaseConfig().url) : null;
});

export const getMenu = cache(async (slug: string) => {
  if (getDataMode() === "demo")
    return slug === DEMO_RESTAURANT_SLUG ? demoMenu : null;
  const row = await getLiveRestaurant(slug);
  if (!row) return null;
  // A closed landing page only needs public branding, not the whole catalog.
  if (!row.is_accepting_orders)
    return {
      ...mapRestaurant(row, requireSupabaseConfig().url),
      categories: [],
      products: [],
    };
  const [menuRows, modifierRows] = await Promise.all([
    fetchMenuRows(createPublicClient(), row.id),
    fetchModifierRows(createPublicClient(), row.id),
  ]);
  return attachModifiers(
    mapMenuRows(row, menuRows, requireSupabaseConfig().url),
    modifierRows,
  );
});

const getTable = cache(async (slug: string, token: string | null) =>
  getDataMode() === "demo"
    ? demoTableContext(token)
    : fetchTableContext(createPublicClient(), slug, token),
);

export async function getCustomerContext(
  slug: string,
  rawToken?: string | string[],
): Promise<CustomerContext | null> {
  const restaurant = await getRestaurant(slug);
  if (!restaurant) return null;
  return {
    mode: getDataMode(),
    restaurant,
    table: await getTable(slug, normalizeTableToken(rawToken)),
  };
}
