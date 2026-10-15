"use server";
import { headers } from "next/headers";
import { getDataMode } from "@/lib/env";
import { getStaffContext } from "@/features/staff/context";
import { createGuestClient } from "@/lib/supabase/guest";
import { verifiedGuest } from "@/features/orders/guest-auth";
import { fetchGuestOrder } from "@/features/orders/repository";
import { validOrderId, validRestaurantSlug } from "@/features/orders/payload";
import { validateOrderOrigin } from "@/features/orders/request-protection";
import { fetchGuestHistory } from "@/features/orders/history/repository";
export type RealtimeScope =
  | { audience: "staff"; restaurantId: string }
  | { audience: "staff-tables"; restaurantId: string }
  | { audience: "guest"; restaurantSlug: string; orderId: string }
  | { audience: "guest-history"; restaurantSlug: string; restaurantId: string }
  | { audience: "guest-table"; restaurantSlug: string; restaurantId: string };
export async function realtimeAccessAction(
  scope: RealtimeScope,
): Promise<{ ok: true; token: string; expiresAt: number } | { ok: false }> {
  try {
    if (getDataMode() !== "live") return { ok: false };
    const h = await headers();
    validateOrderOrigin(
      h.get("origin"),
      h.get("x-forwarded-host") ?? h.get("host"),
      h.get("content-length"),
    );
    let client;
    if (
      (scope?.audience === "staff" || scope?.audience === "staff-tables") &&
      validOrderId(scope.restaurantId)
    )
      client = (await getStaffContext(scope.restaurantId)).client;
    else if (
      scope?.audience === "guest" &&
      validRestaurantSlug(scope.restaurantSlug) &&
      validOrderId(scope.orderId)
    ) {
      client = await createGuestClient(true);
      await verifiedGuest(client, false);
      if (
        !(await fetchGuestOrder(client, scope.restaurantSlug, {
          orderId: scope.orderId,
        }))
      )
        return { ok: false };
    } else if (
      (scope?.audience === "guest-history" ||
        scope?.audience === "guest-table") &&
      validRestaurantSlug(scope.restaurantSlug) &&
      validOrderId(scope.restaurantId)
    ) {
      client = await createGuestClient(true);
      await verifiedGuest(client, false);
      const history = await fetchGuestHistory(client, scope.restaurantSlug);
      if (!history || history.restaurant.id !== scope.restaurantId)
        return { ok: false };
    } else return { ok: false };
    // Identity/ownership was remotely verified above. getSession is used only
    // to transport that caller's short-lived JWT, never to authorize a request.
    const { data } = await client.auth.getSession();
    if (!data.session?.access_token || !data.session.expires_at)
      return { ok: false };
    return {
      ok: true,
      token: data.session.access_token,
      expiresAt: data.session.expires_at * 1000,
    };
  } catch {
    return { ok: false };
  }
}
