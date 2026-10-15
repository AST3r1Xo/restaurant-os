"use server";
import { headers } from "next/headers";
import { getDataMode } from "@/lib/env";
import { createGuestClient } from "@/lib/supabase/guest";
import { GuestSessionError, verifiedGuest } from "./guest-auth";
import { validateOrderOrigin } from "./request-protection";
import { validOrderId, validRestaurantSlug } from "./payload";
import type { OrderProgress } from "./progress";
export async function guestProgressAction(
  restaurantSlug: string,
  orderId: string,
): Promise<
  | { ok: true; progress: OrderProgress }
  | { ok: false; code: "session" | "unavailable"; message: string }
> {
  try {
    if (getDataMode() !== "live")
      return {
        ok: false,
        code: "session",
        message: "Live order tracking is unavailable in demo mode.",
      };
    const h = await headers();
    validateOrderOrigin(
      h.get("origin"),
      h.get("x-forwarded-host") ?? h.get("host"),
    );
    if (!validRestaurantSlug(restaurantSlug) || !validOrderId(orderId))
      return {
        ok: false,
        code: "session",
        message: "This order is not available in this browser.",
      };
    const client = await createGuestClient(true);
    await verifiedGuest(client, false);
    const { data, error } = await client.rpc("get_guest_order_progress", {
      restaurant_slug: restaurantSlug,
      order_id: orderId,
    });
    if (error) throw new Error("Unavailable");
    if (!data)
      return {
        ok: false,
        code: "session",
        message: "This order is not available in this browser.",
      };
    return { ok: true, progress: data as unknown as OrderProgress };
  } catch (error) {
    return {
      ok: false,
      code:
        error instanceof GuestSessionError && error.reason !== "unavailable"
          ? "session"
          : "unavailable",
      message:
        "We couldn’t update your order status. Your confirmed order is still recorded; reconnect to check its progress.",
    };
  }
}
