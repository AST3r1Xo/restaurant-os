"use server";
import { headers } from "next/headers";
import { getDataMode } from "@/lib/env";
import { createGuestClient } from "@/lib/supabase/guest";
import { GuestSessionError, verifiedGuest } from "../guest-auth";
import { validateOrderOrigin } from "../request-protection";
import { fetchGuestHistory } from "./repository";
import type { GuestOrderHistory, HistoryScope } from "./types";

export async function guestHistoryAction(
  slug: string,
  cursor: string | null = null,
  scope?: HistoryScope,
): Promise<
  | { ok: true; value: GuestOrderHistory }
  | { ok: false; code: "session" | "unavailable"; message: string }
> {
  try {
    if (getDataMode() !== "live")
      return {
        ok: false,
        code: "session",
        message: "Real current-visit orders are unavailable in demo mode.",
      };
    const h = await headers();
    validateOrderOrigin(
      h.get("origin"),
      h.get("x-forwarded-host") ?? h.get("host"),
      h.get("content-length"),
    );
    const client = await createGuestClient(true);
    await verifiedGuest(client, false);
    const value = await fetchGuestHistory(client, slug, cursor, scope);
    if (!value)
      return {
        ok: false,
        code: "session",
        message: "These orders are not available in this guest session.",
      };
    return { ok: true, value };
  } catch (error) {
    const session =
      error instanceof GuestSessionError && error.reason !== "unavailable";
    return {
      ok: false,
      code: session ? "session" : "unavailable",
      message: session
        ? "Your guest session is no longer available. Use the browser you used to order; a table QR cannot restore private orders."
        : "We couldn’t verify your current visit. Private details stay hidden until you reconnect.",
    };
  }
}
