import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database.ts";
import type { StaffRestaurant } from "./types.ts";
export class StaffAccessError extends Error {
  readonly reason: "session" | "membership" | "unavailable" | "workspace";
  constructor(reason: "session" | "membership" | "unavailable" | "workspace") {
    super(reason);
    this.reason = reason;
  }
}

export async function verifiedStaff(client: SupabaseClient<Database>) {
  const { data, error } = await client.auth.getUser();
  if (
    error &&
    ![
      "session_not_found",
      "refresh_token_not_found",
      "bad_jwt",
      "user_not_found",
    ].includes(error.code ?? "") &&
    error.name !== "AuthSessionMissingError"
  )
    throw new StaffAccessError("unavailable");
  if (!data.user || data.user.is_anonymous || !data.user.email_confirmed_at)
    throw new StaffAccessError("session");
  return data.user;
}
export async function staffMemberships(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<StaffRestaurant[]> {
  const members = await client
    .from("restaurant_members")
    .select("restaurant_id,role")
    .eq("user_id", userId);
  if (members.error) throw new StaffAccessError("unavailable");
  if (!members.data.length) return [];
  const restaurants = await client
    .from("restaurants")
    .select("id,slug,name,currency,timezone")
    .in(
      "id",
      members.data.map((m) => m.restaurant_id),
    )
    .order("name");
  if (restaurants.error) throw new StaffAccessError("unavailable");
  return restaurants.data.map((r) => ({
    ...r,
    role: members.data.find((m) => m.restaurant_id === r.id)!.role,
  }));
}
export function selectStaffRestaurant(
  memberships: StaffRestaurant[],
  cookieId?: string,
  expectedId?: string,
) {
  const active = memberships.find((r) => r.id === cookieId) ?? memberships[0];
  if (!active) throw new StaffAccessError("membership");
  if (expectedId && active.id !== expectedId)
    throw new StaffAccessError("workspace");
  return active;
}
