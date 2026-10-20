"use server";
import { headers } from "next/headers";
import { getDataMode } from "@/lib/env";
import { createGuestClient } from "@/lib/supabase/guest";
import { GuestSessionError, verifiedGuest } from "@/features/orders/guest-auth";
import { validateOrderOrigin } from "@/features/orders/request-protection";
import { validOrderId, validRestaurantSlug } from "@/features/orders/payload";
import { emptyActivity, fetchGuestActivity } from "./repository";
import type { ActivityContext } from "./repository";
import type { GuestActivity } from "./model";

export async function guestActivityAction(
  input: ActivityContext,
): Promise<
  | { ok: true; value: GuestActivity }
  | { ok: false; code: "session" | "unavailable"; message: string }
> {
  try {
    if (
      getDataMode() !== "live" ||
      !input ||
      Object.keys(input).some(
        (key) =>
          !["slug", "restaurantId", "tableToken", "visitKey"].includes(key),
      ) ||
      !validOrderId(input.restaurantId) ||
      !validRestaurantSlug(input.slug) ||
      (input.tableToken !== undefined && !validOrderId(input.tableToken)) ||
      (input.visitKey !== undefined &&
        (!input.tableToken || !validOrderId(input.visitKey)))
    )
      return {
        ok: false,
        code: "session",
        message: "Scan your current table QR to receive visit updates.",
      };
    const h = await headers();
    validateOrderOrigin(
      h.get("origin"),
      h.get("x-forwarded-host") ?? h.get("host"),
      h.get("content-length"),
    );
    const client = await createGuestClient(true);
    let user;
    try {
      user = await verifiedGuest(client, false);
    } catch (error) {
      // Browsing never creates an account/session just to enable alerts.
      if (error instanceof GuestSessionError && error.reason !== "unavailable")
        return { ok: true, value: emptyActivity(input.restaurantId) };
      throw error;
    }
    return {
      ok: true,
      value: await fetchGuestActivity(client, user.id, input),
    };
  } catch {
    return {
      ok: false,
      code: "unavailable",
      message:
        "Live notifications could not be checked. Your orders stay recorded; reconnect to check the latest updates.",
    };
  }
}
