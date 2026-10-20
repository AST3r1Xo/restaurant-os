import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database.ts";
import { fetchGuestBill, SessionError } from "../sessions/repository.ts";
import { fetchTableContext } from "../menu/repository.ts";
import { validOrderId, validRestaurantSlug } from "../orders/payload.ts";
import type { GuestActivity } from "./model.ts";

export type ActivityContext = {
  slug: string;
  restaurantId: string;
  tableToken?: string;
  visitKey?: string;
};
export function emptyActivity(restaurantId: string): GuestActivity {
  return {
    restaurantId,
    identityKey: null,
    visitId: null,
    fetchedAt: new Date().toISOString(),
    orders: [],
    request: null,
  };
}
export async function fetchGuestActivity(
  client: SupabaseClient<Database>,
  guestId: string,
  input: ActivityContext,
): Promise<GuestActivity> {
  if (
    !validRestaurantSlug(input.slug) ||
    !validOrderId(input.restaurantId) ||
    !validOrderId(guestId) ||
    (input.tableToken !== undefined && !validOrderId(input.tableToken)) ||
    (input.visitKey !== undefined &&
      (!input.tableToken || !validOrderId(input.visitKey)))
  )
    throw new SessionError("INVALID_REQUEST");
  if (input.tableToken) {
    const table = await fetchTableContext(client, input.slug, input.tableToken);
    if (
      table.status !== "valid" ||
      (input.visitKey && table.visitKey !== input.visitKey)
    )
      return emptyActivity(input.restaurantId);
  }
  // This existing RPC verifies participation and an active visit independently
  // of QR possession. Its decoder also binds the result to this restaurant.
  const snapshot = await fetchGuestBill(
    client,
    input.slug,
    input.restaurantId,
    input.tableToken,
  );
  const bill = snapshot.bill;
  if (!bill || bill.access === "closed")
    return emptyActivity(input.restaurantId);
  const orders: GuestActivity["orders"] = [];
  // Read only our minimal order signals, through unchanged active-visit RLS.
  // Pagination avoids silently dropping an older order's service/cancellation.
  for (let offset = 0; ; offset += 250) {
    const result = await client
      .from("orders")
      .select("id,status,created_at,updated_at")
      .eq("restaurant_id", input.restaurantId)
      .eq("customer_id", guestId)
      .eq("session_id", bill.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + 249);
    if (result.error) throw new SessionError("UNAVAILABLE");
    for (const row of result.data ?? [])
      orders.push({
        id: row.id,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    if ((result.data?.length ?? 0) < 250) break;
  }
  // Closure between the RPC and the RLS reads must clear previous alerts.
  if (!orders.length) return emptyActivity(input.restaurantId);
  const request =
    bill.access === "active" && bill.request && bill.request.status !== "closed"
      ? bill.request
      : null;
  return {
    restaurantId: input.restaurantId,
    identityKey: createHash("sha256")
      .update(`${guestId}:${bill.id}`)
      .digest("hex"),
    visitId: bill.id,
    fetchedAt: new Date().toISOString(),
    orders,
    request: request
      ? {
          id: request.id,
          status:
            request.status === "acknowledged" ? "acknowledged" : "requested",
          requestedAt: request.requestedAt,
          acknowledgedAt: request.acknowledgedAt,
        }
      : null,
  };
}
