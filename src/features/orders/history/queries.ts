import "server-only";
import { getDataMode } from "@/lib/env";
import { createGuestClient } from "@/lib/supabase/guest";
import { GuestSessionError, verifiedGuest } from "../guest-auth";
import { fetchGuestHistory } from "./repository";
import type { HistoryScope } from "./types";

export async function getGuestHistory(slug: string, scope?: HistoryScope) {
  if (getDataMode() !== "live") return null;
  const client = await createGuestClient();
  try {
    await verifiedGuest(client, false);
  } catch (error) {
    if (error instanceof GuestSessionError && error.reason !== "unavailable")
      return null;
    throw new Error(
      "Your guest session could not be verified. Please try again.",
    );
  }
  return fetchGuestHistory(client, slug, null, scope);
}
