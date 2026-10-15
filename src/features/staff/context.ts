import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDataMode } from "@/lib/env";
import {
  verifiedStaff,
  staffMemberships,
  selectStaffRestaurant,
  StaffAccessError,
} from "./auth";
export const ACTIVE_RESTAURANT_COOKIE = "restaurant-os-workspace";
export const getStaffContext = cache(async (expectedId?: string) => {
  if (getDataMode() !== "live") throw new StaffAccessError("session");
  const client = await createClient();
  const user = await verifiedStaff(client);
  const memberships = await staffMemberships(client, user.id);
  const active = selectStaffRestaurant(
    memberships,
    (await cookies()).get(ACTIVE_RESTAURANT_COOKIE)?.value,
    expectedId,
  );
  return { client, user, memberships, active };
});
export async function requireStaffPage() {
  try {
    return await getStaffContext();
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof StaffAccessError && error.reason !== "unavailable")
      redirect(`/admin/login?reason=${error.reason}`);
    throw new Error("The workspace could not be loaded. Please try again.");
  }
}
