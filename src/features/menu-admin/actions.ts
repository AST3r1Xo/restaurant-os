"use server";
import { headers } from "next/headers";
import { validateOrderOrigin } from "@/features/orders/request-protection";
import { managerContext, loadWorkspace, adminError } from "./server";
import { uuid, validateProduct } from "./validation";
import type { Json } from "@/types/database";
import type { ProductDefinition, AdminResult, MenuWorkspace } from "./types";
async function context(id: string) {
  const h = await headers();
  validateOrderOrigin(
    h.get("origin"),
    h.get("x-forwarded-host") ?? h.get("host"),
    h.get("content-length"),
  );
  if (!uuid(id)) throw new Error("Refresh your restaurant workspace.");
  return managerContext(id);
}
export async function saveProductAction(
  r: string,
  id: string,
  version: string | null,
  input: ProductDefinition,
): Promise<AdminResult<MenuWorkspace>> {
  try {
    const { client } = await context(r);
    if (!uuid(id)) throw new Error("Invalid dish.");
    validateProduct(input);
    const { error } = await client.rpc("save_menu_product", {
      target_restaurant: r,
      product_id: id,
      expected_version: version as string,
      definition: input as unknown as Json,
    });
    if (error) throw error;
    return { ok: true, data: await loadWorkspace(r) };
  } catch (e) {
    return { ok: false, message: adminError(e) };
  }
}
export async function saveCategoryAction(
  r: string,
  id: string,
  version: string | null,
  input: { name: string; description: string; is_active: boolean },
): Promise<AdminResult<MenuWorkspace>> {
  try {
    const { client } = await context(r);
    if (
      !uuid(id) ||
      !input ||
      typeof input.name !== "string" ||
      !input.name.trim() ||
      input.name.length > 120 ||
      typeof input.description !== "string" ||
      input.description.length > 2000 ||
      typeof input.is_active !== "boolean"
    )
      throw new Error("Enter a category name and description.");
    const { error } = await client.rpc("save_menu_category", {
      target_restaurant: r,
      category_id: id,
      expected_version: version as string,
      definition: input,
    });
    if (error) throw error;
    return { ok: true, data: await loadWorkspace(r) };
  } catch (e) {
    return { ok: false, message: adminError(e) };
  }
}
export async function moveEntryAction(
  r: string,
  id: string,
  kind: "category" | "product",
  direction: number,
): Promise<AdminResult<MenuWorkspace>> {
  try {
    const { client } = await context(r);
    if (
      !uuid(id) ||
      !["category", "product"].includes(kind) ||
      ![-1, 1].includes(direction)
    )
      throw new Error("Invalid ordering action.");
    const { error } = await client.rpc("move_menu_entry", {
      target_restaurant: r,
      entry_id: id,
      entry_kind: kind,
      direction,
    });
    if (error) throw error;
    return { ok: true, data: await loadWorkspace(r) };
  } catch (e) {
    return { ok: false, message: adminError(e) };
  }
}
export async function savePresentationAction(
  r: string,
  version: string,
  input: {
    name: string;
    description: string;
    timezone: string;
    opening_hours: string;
    is_published: boolean;
    is_accepting_orders: boolean;
    logo_asset_id: string | null;
    cover_asset_id: string | null;
    keep_legacy_logo: boolean;
    keep_legacy_cover: boolean;
  },
): Promise<AdminResult<MenuWorkspace>> {
  try {
    const { client } = await context(r);
    if (
      !input ||
      typeof input.name !== "string" ||
      !input.name.trim() ||
      input.name.length > 120 ||
      typeof input.description !== "string" ||
      input.description.length > 4000 ||
      typeof input.timezone !== "string" ||
      input.timezone.length > 100 ||
      typeof input.opening_hours !== "string" ||
      input.opening_hours.length > 1000 ||
      ![input.logo_asset_id, input.cover_asset_id].every(
        (id) => id === null || uuid(id),
      )
    )
      throw new Error("Check the restaurant name, description and time zone.");
    const { error } = await client.rpc("save_restaurant_presentation", {
      target_restaurant: r,
      expected_version: version,
      definition: input,
    });
    if (error) throw error;
    return { ok: true, data: await loadWorkspace(r) };
  } catch (e) {
    return { ok: false, message: adminError(e) };
  }
}
export async function refreshMenuAction(
  r: string,
): Promise<AdminResult<MenuWorkspace>> {
  try {
    await context(r);
    return { ok: true, data: await loadWorkspace(r) };
  } catch (e) {
    return { ok: false, message: adminError(e) };
  }
}

export async function setModelDemonstrationAction(
  r: string,
  id: string,
  version: string,
  enabled: boolean,
  rightsConfirmed: boolean,
): Promise<AdminResult<MenuWorkspace>> {
  try {
    const { client } = await context(r);
    if (
      !uuid(id) ||
      typeof version !== "string" ||
      !Number.isFinite(Date.parse(version)) ||
      typeof enabled !== "boolean" ||
      typeof rightsConfirmed !== "boolean"
    )
      throw new Error("Refresh the dish before changing its 3D presentation.");
    const { error } = await client.rpc("set_model_demonstration", {
      target_restaurant: r,
      target_product: id,
      expected_version: version,
      enabled,
      rights_confirmed: rightsConfirmed,
    });
    if (error) throw error;
    return { ok: true, data: await loadWorkspace(r) };
  } catch (e) {
    return { ok: false, message: adminError(e) };
  }
}
