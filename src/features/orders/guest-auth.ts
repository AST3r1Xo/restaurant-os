import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database.ts";

export class GuestSessionError extends Error {
  readonly reason: "lost" | "unavailable" | "not_guest";
  constructor(reason: "lost" | "unavailable" | "not_guest") {
    super(reason);
    this.reason = reason;
    this.name = "GuestSessionError";
  }
}

// getUser contacts Auth to verify the caller. getSession alone is never an
// authorization boundary. A pending submission must NOT create a new identity.
export async function verifiedGuest(
  client: SupabaseClient<Database>,
  allowCreate: boolean,
) {
  const { data, error } = await client.auth.getUser();
  if (data.user) {
    if (!data.user.is_anonymous) throw new GuestSessionError("not_guest");
    return data.user;
  }
  // Transient Auth failures must not replace a potentially valid identity.
  const missing =
    !error ||
    error.name === "AuthSessionMissingError" ||
    [
      "session_not_found",
      "refresh_token_not_found",
      "user_not_found",
      "bad_jwt",
    ].includes(error.code ?? "");
  if (!missing) throw new GuestSessionError("unavailable");
  if (!allowCreate) throw new GuestSessionError("lost");
  const signedIn = await client.auth.signInAnonymously();
  if (signedIn.error || !signedIn.data.user?.is_anonymous)
    throw new GuestSessionError("unavailable");
  // Verify the issued identity independently, rather than authorizing from a
  // persisted browser-provided user object or sign-in return alone.
  const verified = await client.auth.getUser();
  if (verified.error || !verified.data.user?.is_anonymous)
    throw new GuestSessionError("unavailable");
  return verified.data.user;
}
