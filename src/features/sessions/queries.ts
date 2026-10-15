import "server-only";
import { getDataMode } from "@/lib/env";
import { createGuestClient } from "@/lib/supabase/guest";
import { GuestSessionError, verifiedGuest } from "@/features/orders/guest-auth";
import { fetchGuestHistory } from "@/features/orders/history/repository";
import { fetchGuestBill } from "./repository";
export async function getGuestTablePage(slug: string, token?: string) {
  if (getDataMode() !== "live") return null;
  const client = await createGuestClient();
  try {
    await verifiedGuest(client, false);
  } catch (error) {
    if (error instanceof GuestSessionError && error.reason !== "unavailable")
      return null;
    throw new Error("Your guest session could not be verified. Please retry.");
  }
  const history = await fetchGuestHistory(client, slug);
  if (!history) return null;
  return {
    history,
    snapshot: await fetchGuestBill(client, slug, history.restaurant.id, token),
  };
}
