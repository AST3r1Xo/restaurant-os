"use server";

import { headers } from "next/headers";
import { getDataMode } from "@/lib/env";
import { createGuestClient } from "@/lib/supabase/guest";
import { getCustomerContext } from "@/features/menu/queries";
import { verifiedGuest } from "./guest-auth";
import {
  parseReviewRequest,
  validOrderId,
  validRestaurantSlug,
  InvalidOrderPayload,
} from "./payload";
import {
  fetchGuestOrder,
  fetchOrderReview,
  OrderRepositoryError,
  submitWithRecovery,
} from "./repository";
import { orderFailure } from "./errors";
import { validateOrderOrigin } from "./request-protection";
import type { ConfirmedOrder, OrderResult, OrderReview } from "./types";

async function protectRequest() {
  const requestHeaders = await headers();
  validateOrderOrigin(
    requestHeaders.get("origin"),
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
    requestHeaders.get("content-length"),
  );
}
function demoFailure() {
  return {
    ok: false as const,
    code: "demo" as const,
    message:
      "This is a demo menu. Real order submission is available only in live mode.",
  };
}
function logFailure(operation: string, error: unknown) {
  // Never log raw errors, request bodies, QR codes, identities or credentials.
  if (error instanceof OrderRepositoryError && error.reason === "UNAVAILABLE")
    console.error("Order request unavailable", {
      operation,
      code: error.databaseCode ?? "API_ERROR",
    });
}

export async function reviewOrderAction(
  input: unknown,
): Promise<OrderResult<{ review: OrderReview }>> {
  try {
    await protectRequest();
    const request = parseReviewRequest(input);
    if (getDataMode() !== "live") return demoFailure();
    // Reject bad table/restaurant context before creating an Auth user. The
    // transaction validates these again; this check is not authorization.
    const context = await getCustomerContext(
      request.restaurantSlug,
      request.tableToken,
    );
    if (!context || !context.restaurant.isAcceptingOrders)
      throw new OrderRepositoryError("RESTAURANT_UNAVAILABLE");
    if (context.table.status !== "valid")
      throw new OrderRepositoryError("TABLE_INVALID");
    if (context.table.visitKey !== request.visitKey)
      throw new OrderRepositoryError("SESSION_CHANGED");
    const client = await createGuestClient(true);
    await verifiedGuest(client, true);
    return { ok: true, review: await fetchOrderReview(client, request) };
  } catch (error) {
    logFailure("review", error);
    return orderFailure(error);
  }
}

export async function submitOrderAction(
  input: unknown,
): Promise<OrderResult<{ order: ConfirmedOrder }>> {
  try {
    await protectRequest();
    const request = parseReviewRequest(input, true);
    if (getDataMode() !== "live") return demoFailure();
    const client = await createGuestClient(true);
    // Never create a replacement guest while retrying a potentially committed
    // order. Shared table context cannot recover a missing guest identity.
    await verifiedGuest(client, false);
    return { ok: true, order: await submitWithRecovery(client, request) };
  } catch (error) {
    logFailure("submit", error);
    return orderFailure(error);
  }
}

export async function recoverOrderAction(
  restaurantSlug: string,
  idempotencyKey: string,
): Promise<OrderResult<{ order: ConfirmedOrder | null }>> {
  try {
    await protectRequest();
    if (!validRestaurantSlug(restaurantSlug) || !validOrderId(idempotencyKey))
      throw new InvalidOrderPayload();
    if (getDataMode() !== "live") return demoFailure();
    const client = await createGuestClient(true);
    await verifiedGuest(client, false);
    return {
      ok: true,
      order: await fetchGuestOrder(client, restaurantSlug, { idempotencyKey }),
    };
  } catch (error) {
    logFailure("recover", error);
    return orderFailure(error);
  }
}
