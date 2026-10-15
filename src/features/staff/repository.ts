import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database.ts";
import { decodeKitchenSnapshot } from "./model.ts";
import type { OrderStatus } from "../orders/types.ts";
export class KitchenError extends Error {
  readonly code: string;
  constructor(code: string) {
    super("Kitchen request failed");
    this.code = code;
  }
}

export async function fetchKitchen(
  client: SupabaseClient<Database>,
  restaurantId: string,
) {
  const result = await client.rpc("get_kitchen_snapshot", {
    target_restaurant: restaurantId,
  });
  if (result.error)
    throw new KitchenError(
      result.error.code === "P0001" ? result.error.message : "UNAVAILABLE",
    );
  return decodeKitchenSnapshot(result.data, restaurantId);
}
export async function changeOrderStatus(
  client: SupabaseClient<Database>,
  restaurantId: string,
  input: {
    orderId: string;
    expectedStatus: OrderStatus;
    nextStatus: OrderStatus;
    reason?: string;
  },
) {
  const result = await client.rpc("transition_order", {
    target_restaurant: restaurantId,
    target_order: input.orderId,
    expected_status: input.expectedStatus,
    next_status: input.nextStatus,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  });
  if (result.error)
    throw new KitchenError(
      result.error.code === "P0001" ? result.error.message : "UNAVAILABLE",
    );
}
