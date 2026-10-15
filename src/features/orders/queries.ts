import "server-only";
import { getDataMode } from "@/lib/env";
import { createGuestClient } from "@/lib/supabase/guest";
import { GuestSessionError, verifiedGuest } from "./guest-auth";
import { validOrderId, validRestaurantSlug } from "./payload";
import { fetchGuestOrder } from "./repository";

// No QR lookup can authorize this query. PostgreSQL independently restricts the
// snapshot to auth.uid(); page rendering never establishes a new guest.
export async function getConfirmedOrder(
  restaurantSlug: string,
  orderId: string,
) {
  if (
    getDataMode() !== "live" ||
    !validRestaurantSlug(restaurantSlug) ||
    !validOrderId(orderId)
  )
    return null;
  const client = await createGuestClient();
  try {
    await verifiedGuest(client, false);
  } catch (error) {
    if (error instanceof GuestSessionError && error.reason !== "unavailable")
      return null;
    throw new Error("We couldn’t verify your guest session. Please try again.");
  }
  return fetchGuestOrder(client, restaurantSlug, { orderId });
}
