"use server";
import { headers } from "next/headers";
import { getDataMode } from "@/lib/env";
import { createGuestClient } from "@/lib/supabase/guest";
import { GuestSessionError, verifiedGuest } from "@/features/orders/guest-auth";
import { fetchGuestHistory } from "@/features/orders/history/repository";
import { validateOrderOrigin } from "@/features/orders/request-protection";
import { validOrderId, validRestaurantSlug } from "@/features/orders/payload";
import { getStaffContext } from "@/features/staff/context";
import { StaffAccessError } from "@/features/staff/auth";
import {
  fetchGuestBill,
  fetchWorkspace,
  fetchSessionOrders,
  SessionError,
} from "./repository";
import type {
  GuestBillSnapshot,
  TableWorkspace,
  SessionOrders,
  SessionResult,
} from "./types";
async function protect() {
  if (getDataMode() !== "live") throw new SessionError("DEMO");
  const h = await headers();
  validateOrderOrigin(
    h.get("origin"),
    h.get("x-forwarded-host") ?? h.get("host"),
    h.get("content-length"),
  );
}
const messages: Record<string, string> = {
  RESTAURANT_UNAVAILABLE:
    "The restaurant is CLOSED. Open it before starting a new dining session. Existing service can continue.",
  PARTICIPATION_REQUIRED:
    "The table bill is available during your active visit once the kitchen confirms your first order. If service has ended, scan your table QR to start fresh.",
  SESSION_CLOSED:
    "This dining session has ended. A new visit has a separate bill.",
  TABLE_INVALID:
    "This table QR is unavailable. Scan the current code or ask staff for help.",
  ACTIVE_ORDERS:
    "Finish serving or cancelling this session’s orders before closing it.",
  REQUEST_UNACKNOWLEDGED:
    "Acknowledge the bill request before closing this session.",
  RATE_LIMITED:
    "Please wait before making another bill request. Staff can help you directly.",
  REQUEST_NOT_FOUND: "There is no pending bill request for this session.",
};
function failure(error: unknown): SessionResult<never> {
  if (error instanceof StaffAccessError)
    return {
      ok: false,
      code: error.reason,
      message:
        "Restaurant access has changed. Sign in or refresh the active workspace.",
    };
  if (error instanceof GuestSessionError && error.reason !== "unavailable")
    return {
      ok: false,
      code: "session",
      message:
        "Your guest session is no longer available. Use your original browser or ask staff for help.",
    };
  if (error instanceof SessionError) {
    if (
      ["STAFF_REQUIRED", "STAFF_FORBIDDEN", "SESSION_REQUIRED"].includes(
        error.code,
      )
    )
      return {
        ok: false,
        code: "session",
        message:
          "Your session could not be verified. Please refresh or sign in again.",
      };
    if (messages[error.code])
      return { ok: false, code: error.code, message: messages[error.code] };
  }
  return {
    ok: false,
    code: "unavailable",
    message:
      "We couldn’t confirm the latest table information. Reconnect and refresh before retrying; your orders are safely recorded.",
  };
}
export async function guestTableAction(
  slug: string,
  token?: string,
): Promise<SessionResult<GuestBillSnapshot>> {
  try {
    await protect();
    const client = await createGuestClient(true);
    await verifiedGuest(client, false);
    const history = await fetchGuestHistory(client, slug);
    if (!history) throw new GuestSessionError("lost");
    return {
      ok: true,
      value: await fetchGuestBill(client, slug, history.restaurant.id, token),
    };
  } catch (error) {
    return failure(error);
  }
}
export async function requestBillAction(
  slug: string,
  sessionId: string,
  token?: string,
): Promise<SessionResult<GuestBillSnapshot>> {
  try {
    await protect();
    if (
      !validRestaurantSlug(slug) ||
      !validOrderId(sessionId) ||
      (token !== undefined && !validOrderId(token))
    )
      throw new SessionError("INVALID_REQUEST");
    const client = await createGuestClient(true);
    await verifiedGuest(client, false);
    const { error } = await client.rpc("request_session_bill", {
      restaurant_slug: slug,
      target_session: sessionId,
    });
    if (error)
      throw new SessionError(
        error.code === "P0001" ? error.message : "UNAVAILABLE",
      );
    const history = await fetchGuestHistory(client, slug);
    if (!history) throw new GuestSessionError("lost");
    return {
      ok: true,
      value: await fetchGuestBill(client, slug, history.restaurant.id, token),
    };
  } catch (error) {
    return failure(error);
  }
}
export async function tableWorkspaceAction(
  id: string,
  cursor?: string,
): Promise<SessionResult<TableWorkspace>> {
  try {
    await protect();
    const { client, active } = await getStaffContext(id);
    return { ok: true, value: await fetchWorkspace(client, active.id, cursor) };
  } catch (error) {
    return failure(error);
  }
}
export async function sessionOrdersAction(
  id: string,
  session: string,
  cursor?: string,
): Promise<SessionResult<SessionOrders>> {
  try {
    await protect();
    const { client, active } = await getStaffContext(id);
    return {
      ok: true,
      value: await fetchSessionOrders(client, active.id, session, cursor),
    };
  } catch (error) {
    return failure(error);
  }
}
export async function manageSessionAction(input: {
  restaurantId: string;
  tableId: string;
  operation: "open" | "close" | "acknowledge";
  sessionId?: string;
}): Promise<SessionResult<TableWorkspace>> {
  try {
    await protect();
    if (
      !input ||
      Object.keys(input).some(
        (k) =>
          !["restaurantId", "tableId", "operation", "sessionId"].includes(k),
      ) ||
      !validOrderId(input.restaurantId) ||
      !validOrderId(input.tableId) ||
      !["open", "close", "acknowledge"].includes(input.operation) ||
      (input.sessionId !== undefined && !validOrderId(input.sessionId))
    )
      throw new SessionError("INVALID_REQUEST");
    const { client, active } = await getStaffContext(input.restaurantId);
    const { error } = await client.rpc("manage_table_session", {
      target_restaurant: active.id,
      target_table: input.tableId,
      operation: input.operation,
      ...(input.sessionId ? { target_session: input.sessionId } : {}),
    });
    if (error)
      throw new SessionError(
        error.code === "P0001" ? error.message : "UNAVAILABLE",
      );
    return { ok: true, value: await fetchWorkspace(client, active.id) };
  } catch (error) {
    return failure(error);
  }
}
