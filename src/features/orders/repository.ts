import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database.ts";
import type {
  ConfirmedOrder,
  OrderLine,
  OrderReview,
  OrderStatus,
} from "./types.ts";
import { databaseItems, validOrderId, validRestaurantSlug } from "./payload.ts";
import type { ReviewRequest, SubmitRequest } from "./payload.ts";

type Client = SupabaseClient<Database>;
const knownErrors = new Set([
  "INVALID_REQUEST",
  "SESSION_REQUIRED",
  "RESTAURANT_UNAVAILABLE",
  "TABLE_INVALID",
  "PRODUCT_UNAVAILABLE",
  "OPTIONS_INVALID",
  "QUANTITY_INVALID",
  "REVIEW_EXPIRED",
  "ORDER_CHANGED",
  "SESSION_CHANGED",
  "VISIT_ENDED",
  "IDEMPOTENCY_CONFLICT",
  "RATE_LIMITED",
]);
export class OrderRepositoryError extends Error {
  readonly reason: string;
  readonly databaseCode?: string;
  constructor(reason: string, databaseCode?: string) {
    super("The order request could not be completed.");
    this.reason = reason;
    this.databaseCode = databaseCode;
    this.name = "OrderRepositoryError";
  }
}
function fail(error: { code?: string; message?: string } | null) {
  if (!error) return;
  const code =
    error.code && /^[A-Z0-9]{5}$/.test(error.code) ? error.code : undefined;
  throw new OrderRepositoryError(
    error.code === "P0001" && knownErrors.has(error.message ?? "")
      ? error.message!
      : "UNAVAILABLE",
    code,
  );
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, max: number): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= max
  );
}
function money(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 2147483647
  );
}
function date(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    Number.isFinite(Date.parse(value))
  );
}
function invalid(): never {
  throw new OrderRepositoryError("UNAVAILABLE");
}
function summary(value: unknown, restaurantSlug: string) {
  if (
    !record(value) ||
    !record(value.restaurant) ||
    !record(value.table) ||
    !validOrderId(value.restaurant.id) ||
    value.restaurant.slug !== restaurantSlug ||
    !text(value.restaurant.name, 120) ||
    !text(value.table.label, 60) ||
    !["EUR", "USD", "GBP"].includes(value.currency as string) ||
    !Array.isArray(value.items) ||
    !value.items.length ||
    value.items.length > 50 ||
    !money(value.totalMinor)
  )
    invalid();
  const items: OrderLine[] = value.items.map((item) => {
    if (
      !record(item) ||
      !validOrderId(item.productId) ||
      !text(item.productName, 160) ||
      !Number.isInteger(item.quantity) ||
      (item.quantity as number) < 1 ||
      (item.quantity as number) > 99 ||
      !money(item.basePriceMinor) ||
      !money(item.unitPriceMinor) ||
      !money(item.lineTotalMinor) ||
      !Array.isArray(item.options) ||
      item.options.length > 50
    )
      invalid();
    const options = item.options.map((option) => {
      if (
        !record(option) ||
        !validOrderId(option.id) ||
        !validOrderId(option.groupId) ||
        !text(option.groupName, 120) ||
        !text(option.name, 160) ||
        !money(option.priceAdjustmentMinor)
      )
        invalid();
      return {
        id: option.id,
        groupId: option.groupId,
        groupName: option.groupName,
        name: option.name,
        priceAdjustmentMinor: option.priceAdjustmentMinor,
      };
    });
    if (
      new Set(options.map((option) => option.id)).size !== options.length ||
      item.unitPriceMinor !==
        item.basePriceMinor +
          options.reduce(
            (sum, option) => sum + option.priceAdjustmentMinor,
            0,
          ) ||
      item.lineTotalMinor !== item.unitPriceMinor * (item.quantity as number)
    )
      invalid();
    return {
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity as number,
      basePriceMinor: item.basePriceMinor,
      unitPriceMinor: item.unitPriceMinor,
      lineTotalMinor: item.lineTotalMinor,
      options,
    };
  });
  if (
    items.reduce((sum, item) => sum + item.lineTotalMinor, 0) !==
    value.totalMinor
  )
    invalid();
  return {
    restaurant: {
      id: value.restaurant.id,
      slug: restaurantSlug,
      name: value.restaurant.name,
    },
    table: { label: value.table.label },
    currency: value.currency as string,
    items,
    totalMinor: value.totalMinor,
  };
}
export function decodeOrderReview(
  value: unknown,
  restaurantSlug: string,
): OrderReview {
  const parsed = summary(value, restaurantSlug);
  if (!record(value) || !validOrderId(value.reviewId) || !date(value.expiresAt))
    invalid();
  return { ...parsed, reviewId: value.reviewId, expiresAt: value.expiresAt };
}
export function decodeConfirmedOrder(
  value: unknown,
  restaurantSlug: string,
): ConfirmedOrder {
  const parsed = summary(value, restaurantSlug);
  if (
    !record(value) ||
    !validOrderId(value.id) ||
    !text(value.reference, 60) ||
    !date(value.createdAt) ||
    ![
      "pending",
      "accepted",
      "preparing",
      "ready",
      "served",
      "cancelled",
    ].includes(value.status as string) ||
    !money(value.subtotalMinor) ||
    value.subtotalMinor !== parsed.totalMinor
  )
    invalid();
  return {
    ...parsed,
    id: value.id,
    reference: value.reference,
    status: value.status as OrderStatus,
    createdAt: value.createdAt,
    subtotalMinor: value.subtotalMinor,
  };
}
export async function fetchOrderReview(
  client: Client,
  request: ReviewRequest,
): Promise<OrderReview> {
  const { data, error } = await client.rpc("review_visit_order", {
    restaurant_slug: request.restaurantSlug,
    table_token: request.tableToken,
    visit_key: request.visitKey,
    items: databaseItems(request.items),
  });
  fail(error);
  return decodeOrderReview(data, request.restaurantSlug);
}
export async function createGuestOrder(
  client: Client,
  request: SubmitRequest,
): Promise<ConfirmedOrder> {
  const { data, error } = await client.rpc("create_guest_order", {
    restaurant_slug: request.restaurantSlug,
    table_token: request.tableToken,
    items: databaseItems(request.items),
    idempotency_key: request.idempotencyKey,
    review_id: request.reviewId,
  });
  fail(error);
  return decodeConfirmedOrder(data, request.restaurantSlug);
}
export async function fetchGuestOrder(
  client: Client,
  restaurantSlug: string,
  lookup: { orderId: string } | { idempotencyKey: string },
): Promise<ConfirmedOrder | null> {
  if (
    !validRestaurantSlug(restaurantSlug) ||
    !("orderId" in lookup
      ? validOrderId(lookup.orderId)
      : validOrderId(lookup.idempotencyKey))
  )
    return null;
  const { data, error } = await client.rpc("get_guest_order", {
    restaurant_slug: restaurantSlug,
    ...("orderId" in lookup
      ? { order_id: lookup.orderId }
      : { idempotency_key: lookup.idempotencyKey }),
  });
  fail(error);
  return data === null ? null : decodeConfirmedOrder(data, restaurantSlug);
}

// Call only after verifiedGuest(client, false). A network failure can follow a
// successful COMMIT; recover by the original key rather than minting a new one.
export async function submitWithRecovery(
  client: Client,
  request: SubmitRequest,
) {
  try {
    return await createGuestOrder(client, request);
  } catch (error) {
    if (
      !(error instanceof OrderRepositoryError) ||
      error.reason === "UNAVAILABLE"
    ) {
      try {
        const order = await fetchGuestOrder(client, request.restaurantSlug, {
          idempotencyKey: request.idempotencyKey,
        });
        if (order) return order;
      } catch {
        // No server proof of success. Keep the original submission for retry.
      }
    }
    throw error;
  }
}
