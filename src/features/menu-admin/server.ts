import "server-only";
import { getStaffContext } from "@/features/staff/context";
import type { MenuWorkspace } from "./types";
export async function managerContext(restaurantId?: string) {
  const ctx = await getStaffContext(restaurantId);
  if (!["owner", "manager"].includes(ctx.active.role))
    throw new Error("Only restaurant owners and managers can edit the menu.");
  return ctx;
}
export async function loadWorkspace(
  restaurantId?: string,
): Promise<MenuWorkspace> {
  const { client, active } = await managerContext(restaurantId);
  const { data, error } = await client.rpc("menu_workspace", {
    target_restaurant: active.id,
  });
  if (error)
    throw new Error(
      "The menu workspace could not be loaded. Please reconnect and try again.",
    );
  return data as unknown as MenuWorkspace;
}
export function adminError(error: unknown) {
  const code =
    typeof error === "object" && error && "message" in error
      ? String(error.message)
      : "";
  if (code === "MENU_CONFLICT")
    return "Another manager changed this item. Refresh the workspace before editing again.";
  if (code === "ASSET_IN_USE")
    return "This file is still used by a dish or restaurant branding. Replace or remove that reference and save first.";
  if (code === "UPLOAD_RATE_LIMIT")
    return "Too many uploads. Please wait before uploading more files.";
  if (
    /^(MENU_INVALID|MODIFIERS_INVALID|CATEGORY_INVALID|ASSET_INVALID|MODEL_REVIEW_REQUIRED)$/.test(
      code,
    )
  )
    return "Check the category, customization limits and reviewed media, then try again.";
  if (code.includes("duplicate key"))
    return "That name is already used in this category or customization. Choose a different name.";
  if (error instanceof Error && !("code" in error)) return error.message;
  return "The update could not be confirmed. Refresh to check the latest version before retrying.";
}
