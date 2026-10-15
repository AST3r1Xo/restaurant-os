"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDataMode, requireSupabaseConfig } from "@/lib/env";
import { isStaffCookie } from "@/lib/supabase/staff-cookie";
import { validateOrderOrigin } from "@/features/orders/request-protection";
import { validOrderId } from "@/features/orders/payload";
import { StaffAccessError, staffMemberships, verifiedStaff } from "./auth";
import { getStaffContext, ACTIVE_RESTAURANT_COOKIE } from "./context";
import { KitchenError, changeOrderStatus, fetchKitchen } from "./repository";
import { statuses } from "./model";
import type { OrderStatus } from "@/features/orders/types";
import type { KitchenSnapshot, StaffResult } from "./types";
async function protect() {
  const h = await headers();
  validateOrderOrigin(
    h.get("origin"),
    h.get("x-forwarded-host") ?? h.get("host"),
    h.get("content-length"),
  );
}
function failure(error: unknown): StaffResult<never> {
  if (error instanceof StaffAccessError)
    return {
      ok: false,
      code: error.reason,
      message:
        error.reason === "session"
          ? "Your staff session has ended. Please sign in again."
          : error.reason === "membership"
            ? "This account has no restaurant access. Ask the owner to assign your membership."
            : error.reason === "workspace"
              ? "Your active restaurant changed in another tab. Refresh this workspace."
              : "The workspace could not be reached. Please try again.",
    };
  if (error instanceof KitchenError) {
    if (["STAFF_REQUIRED", "STAFF_FORBIDDEN"].includes(error.code))
      return {
        ok: false,
        code: "membership",
        message:
          "Restaurant access could not be verified. Please sign in again.",
      };
    if (error.code === "STATUS_CONFLICT")
      return {
        ok: false,
        code: "conflict",
        message:
          "Another team member updated this order. The latest status has been loaded.",
      };
    if (
      ["INVALID_TRANSITION", "INVALID_REASON", "ORDER_NOT_FOUND"].includes(
        error.code,
      )
    )
      return {
        ok: false,
        code: "invalid",
        message:
          "This action is no longer available. Check the order status and decline reason.",
      };
  }
  return {
    ok: false,
    code: "unavailable",
    message:
      "We couldn’t confirm this update. The order has been kept; reconnect to check its current status before trying again.",
  };
}
export async function loginStaffAction(input: {
  email: string;
  password: string;
}): Promise<StaffResult<object>> {
  try {
    await protect();
    if (
      getDataMode() !== "live" ||
      !input ||
      typeof input.email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) ||
      input.email.length > 254 ||
      typeof input.password !== "string" ||
      input.password.length < 1 ||
      input.password.length > 256
    )
      return {
        ok: false,
        code: "invalid",
        message: "Enter your staff email and password.",
      };
    const client = await createClient();
    const result = await client.auth.signInWithPassword({
      email: input.email.trim(),
      password: input.password,
    });
    if (result.error)
      return {
        ok: false,
        code: "session",
        message:
          "We couldn’t sign you in. Check your email and password, or ask the restaurant owner for help.",
      };
    const user = await verifiedStaff(client);
    const members = await staffMemberships(client, user.id);
    if (!members.length) throw new StaffAccessError("membership");
    (await cookies()).set(ACTIVE_RESTAURANT_COOKIE, members[0].id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 2592000,
    });
  } catch (error) {
    return failure(error);
  }
  redirect("/admin/orders");
}
export async function signOutStaffAction() {
  await protect();
  const client = await createClient();
  await client.auth.signOut({ scope: "local" }).catch(() => {});
  const store = await cookies();
  const { url } = requireSupabaseConfig();
  store
    .getAll()
    .filter((c) => isStaffCookie(c.name, url))
    .forEach((c) => store.delete(c.name));
  (await cookies()).delete(ACTIVE_RESTAURANT_COOKIE);
  redirect("/admin/login");
}
export async function selectRestaurantAction(
  restaurantId: string,
): Promise<StaffResult<object>> {
  try {
    await protect();
    const { memberships } = await getStaffContext();
    if (!memberships.some((r) => r.id === restaurantId))
      throw new StaffAccessError("membership");
    (await cookies()).set(ACTIVE_RESTAURANT_COOKIE, restaurantId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 2592000,
    });
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}
export async function kitchenSnapshotAction(
  restaurantId: string,
): Promise<StaffResult<{ snapshot: KitchenSnapshot }>> {
  try {
    await protect();
    const { client, active } = await getStaffContext(restaurantId);
    return { ok: true, snapshot: await fetchKitchen(client, active.id) };
  } catch (error) {
    return failure(error);
  }
}
export async function transitionOrderAction(input: {
  restaurantId: string;
  orderId: string;
  expectedStatus: OrderStatus;
  nextStatus: OrderStatus;
  reason?: string;
}): Promise<StaffResult<{ snapshot: KitchenSnapshot }>> {
  try {
    await protect();
    if (
      !input ||
      Object.keys(input).some(
        (k) =>
          ![
            "restaurantId",
            "orderId",
            "expectedStatus",
            "nextStatus",
            "reason",
          ].includes(k),
      ) ||
      !validOrderId(input.restaurantId) ||
      !validOrderId(input.orderId) ||
      !statuses.includes(input.expectedStatus) ||
      !statuses.includes(input.nextStatus) ||
      (input.reason !== undefined &&
        (typeof input.reason !== "string" || input.reason.length > 300))
    )
      throw new KitchenError("INVALID_TRANSITION");
    const { client, active } = await getStaffContext(input.restaurantId);
    await changeOrderStatus(client, active.id, input);
    return { ok: true, snapshot: await fetchKitchen(client, active.id) };
  } catch (error) {
    return failure(error);
  }
}
