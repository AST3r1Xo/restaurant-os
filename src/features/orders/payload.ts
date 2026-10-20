import type { CartIntent } from "../cart/model.ts";
import { cartLineKey } from "../cart/model.ts";
import { specialRequestFields, validSpecialRequest } from "../cart/special-request.ts";

export const MAX_ORDER_LINES = 50;
export const MAX_ORDER_QUANTITY = 500;
export const MAX_ORDER_BYTES = 64 * 1024;
export const MAX_ORDER_OPTIONS = 50;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const qrUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ReviewRequest = {
  restaurantSlug: string;
  tableToken: string;
  visitKey: string;
  items: CartIntent[];
};
export type SubmitRequest = ReviewRequest & {
  idempotencyKey: string;
  reviewId: string;
};
export class InvalidOrderPayload extends Error {
  constructor() {
    super("Please review your bag before placing this order.");
    this.name = "InvalidOrderPayload";
  }
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
export function validOrderId(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}
export function validRestaurantSlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 120 &&
    /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)
  );
}

// Strict whitelisting rejects financial, ownership, and status fields. Intent
// normalization is only request hygiene; PostgreSQL independently validates it.
export function parseReviewRequest(
  value: unknown,
  submit?: false,
): ReviewRequest;
export function parseReviewRequest(value: unknown, submit: true): SubmitRequest;
export function parseReviewRequest(
  value: unknown,
  submit = false,
): ReviewRequest | SubmitRequest {
  let size: number;
  try {
    size = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    throw new InvalidOrderPayload();
  }
  const keys = [
    "restaurantSlug",
    "tableToken",
    "visitKey",
    "items",
    ...(submit ? ["idempotencyKey", "reviewId"] : []),
  ];
  if (
    size > MAX_ORDER_BYTES ||
    !record(value) ||
    !exactKeys(value, keys) ||
    !validRestaurantSlug(value.restaurantSlug) ||
    typeof value.tableToken !== "string" ||
    !qrUuid.test(value.tableToken) ||
    !validOrderId(value.visitKey) ||
    !Array.isArray(value.items) ||
    !value.items.length ||
    value.items.length > MAX_ORDER_LINES
  )
    throw new InvalidOrderPayload();
  const items: CartIntent[] = [];
  const seen = new Set<string>();
  let quantity = 0;
  for (const item of value.items) {
    if (
      !record(item) ||
      !exactKeys(item, ["productId", "optionIds", "quantity", ...(Object.hasOwn(item, "notes") ? ["notes"] : [])]) ||
      (Object.hasOwn(item, "notes") && !validSpecialRequest(item.notes)) ||
      !validOrderId(item.productId) ||
      !Number.isInteger(item.quantity) ||
      (item.quantity as number) < 1 ||
      (item.quantity as number) > 99 ||
      !Array.isArray(item.optionIds) ||
      item.optionIds.length > MAX_ORDER_OPTIONS ||
      !item.optionIds.every(validOrderId)
    )
      throw new InvalidOrderPayload();
    const productId = item.productId.toLowerCase();
    const optionIds = item.optionIds.map((id) => id.toLowerCase()).sort();
    if (new Set(optionIds).size !== optionIds.length)
      throw new InvalidOrderPayload();
    const notes = specialRequestFields(item.notes as string | undefined);
    const key = cartLineKey({ productId, optionIds, ...notes });
    if (seen.has(key)) throw new InvalidOrderPayload();
    seen.add(key);
    quantity += item.quantity as number;
    if (quantity > MAX_ORDER_QUANTITY) throw new InvalidOrderPayload();
    items.push({ productId, optionIds, quantity: item.quantity as number, ...notes });
  }
  items.sort((a, b) =>
    cartLineKey(a).localeCompare(cartLineKey(b)),
  );
  const request = {
    restaurantSlug: value.restaurantSlug,
    tableToken: value.tableToken.toLowerCase(),
    visitKey: value.visitKey.toLowerCase(),
    items,
  };
  if (!submit) return request;
  if (!validOrderId(value.idempotencyKey) || !validOrderId(value.reviewId))
    throw new InvalidOrderPayload();
  return {
    ...request,
    idempotencyKey: value.idempotencyKey.toLowerCase(),
    reviewId: value.reviewId.toLowerCase(),
  };
}

export function databaseItems(items: CartIntent[]) {
  return items.map((item) => ({
    productId: item.productId,
    optionIds: item.optionIds,
    quantity: item.quantity,
    ...specialRequestFields(item.notes),
  }));
}
