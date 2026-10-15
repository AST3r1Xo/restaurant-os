"use server";

import { getMenu, getCustomerContext } from "@/features/menu/queries";
import { headers } from "next/headers";
import { validateOrderOrigin } from "@/features/orders/request-protection";
import { validOrderId, validRestaurantSlug } from "@/features/orders/payload";
import { productRevision, validateSelection } from "./model";

// Public, read-only validation. This does not submit or price an order.
export async function validateCartAddition(
  slug: string,
  productId: string,
  optionIds: string[],
  quantity: number,
  revision: string,
  token?: string,
  visitKey?: string,
): Promise<{ ok: true } | { ok: false; message: string; refresh?: boolean }> {
  if (
    typeof slug !== "string" ||
    slug.length > 120 ||
    typeof productId !== "string" ||
    productId.length > 160 ||
    typeof revision !== "string" ||
    revision.length > 100000
  )
    return { ok: false, message: "Please refresh the menu and try again." };
  try {
    if (token && visitKey) {
      const context = await getCustomerContext(slug, token);
      if (
        context?.table.status !== "valid" ||
        context.table.visitKey !== visitKey
      )
        return {
          ok: false,
          message: "This visit has ended. Scan your table QR to start fresh.",
          refresh: true,
        };
    }
    const menu = await getMenu(slug);
    const product = menu?.products.find((product) => product.id === productId);
    if (!product)
      return {
        ok: false,
        message: "This dish is no longer available.",
        refresh: true,
      };
    const error = validateSelection(product, optionIds, quantity);
    if (error) return { ok: false, message: error, refresh: true };
    if (productRevision(product) !== revision)
      return {
        ok: false,
        message:
          "The menu has changed. Review the updated dish before adding it.",
        refresh: true,
      };
    return { ok: true };
  } catch {
    return {
      ok: false,
      message: "We couldn’t check the menu. Please try again.",
    };
  }
}

// Public lifecycle information only: never orders, sessions, participants or Auth.
export async function currentVisitKeyAction(slug: string, token: string) {
  const h = await headers();
  validateOrderOrigin(
    h.get("origin"),
    h.get("x-forwarded-host") ?? h.get("host"),
    h.get("content-length"),
  );
  if (!validRestaurantSlug(slug) || !validOrderId(token))
    throw new Error("Invalid table context");
  const context = await getCustomerContext(slug, token);
  return context?.table.status === "valid" ? context.table.visitKey : null;
}
