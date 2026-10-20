import type { CartScope, StorageAdapter } from "../cart/persistence.ts";
import { parseReviewRequest, validOrderId } from "./payload.ts";
import type { SubmitRequest } from "./payload.ts";
import type { OrderReview } from "./types.ts";
import { cartLineKey } from "../cart/model.ts";
import { specialRequestFields, validSpecialRequest } from "../cart/special-request.ts";

export type StoredSubmission = {
  version: 2;
  restaurantId: string;
  mode: "live";
  currency: string;
  visitKey?: string;
  request: SubmitRequest;
  review: OrderReview;
  confirmedOrderId?: string;
};
type SubmissionStorage = StorageAdapter & Pick<Storage, "removeItem">;

export function submissionStorageKey(scope: CartScope) {
  return `restaurant-os:submission:v2:${scope.mode}:${encodeURIComponent(scope.restaurantId)}:${encodeURIComponent(scope.visitKey ?? "unbound")}`;
}
export function intentFingerprint(items: SubmitRequest["items"]) {
  return JSON.stringify(
    items
      .map((item) => ({
        productId: item.productId,
        optionIds: [...item.optionIds].sort(),
        quantity: item.quantity,
        ...specialRequestFields(item.notes),
      }))
      .sort((a, b) =>
        cartLineKey(a).localeCompare(cartLineKey(b)),
      ),
  );
}
function validReview(value: unknown): value is OrderReview {
  if (!value || typeof value !== "object") return false;
  const quote = value as OrderReview;
  return (
    validOrderId(quote.reviewId) &&
    typeof quote.expiresAt === "string" &&
    Number.isFinite(Date.parse(quote.expiresAt)) &&
    typeof quote.restaurant?.id === "string" &&
    typeof quote.restaurant?.slug === "string" &&
    typeof quote.restaurant?.name === "string" &&
    typeof quote.table?.label === "string" &&
    typeof quote.currency === "string" &&
    Number.isSafeInteger(quote.totalMinor) &&
    quote.totalMinor >= 0 &&
    Array.isArray(quote.items) &&
    quote.items.length > 0 &&
    quote.items.length <= 50 &&
    quote.items.every(
      (item) =>
        validOrderId(item.productId) &&
        typeof item.productName === "string" &&
        Number.isInteger(item.quantity) &&
        item.quantity > 0 &&
        item.quantity <= 99 &&
        (item.notes === undefined || validSpecialRequest(item.notes)) &&
        [item.basePriceMinor, item.unitPriceMinor, item.lineTotalMinor].every(
          (price) => Number.isSafeInteger(price) && price >= 0,
        ) &&
        Array.isArray(item.options) &&
        item.options.length <= 50 &&
        item.options.every(
          (option) =>
            validOrderId(option.id) &&
            validOrderId(option.groupId) &&
            typeof option.groupName === "string" &&
            typeof option.name === "string" &&
            Number.isSafeInteger(option.priceAdjustmentMinor) &&
            option.priceAdjustmentMinor >= 0,
        ),
    )
  );
}

export function parseStoredSubmission(
  raw: string | null,
  scope: CartScope,
): StoredSubmission | null {
  if (!raw || raw.length > 200000 || scope.mode !== "live") return null;
  try {
    const value = JSON.parse(raw) as StoredSubmission;
    if (
      value.version !== 2 ||
      value.restaurantId !== scope.restaurantId ||
      value.mode !== scope.mode ||
      value.currency !== scope.currency ||
      value.visitKey !== scope.visitKey ||
      value.request.visitKey !== scope.visitKey ||
      !validReview(value.review) ||
      value.review.restaurant.id !== scope.restaurantId ||
      value.review.currency !== scope.currency ||
      (value.confirmedOrderId !== undefined &&
        !validOrderId(value.confirmedOrderId))
    )
      return null;
    const request = parseReviewRequest(value.request, true);
    if (
      request.reviewId !== value.review.reviewId ||
      request.restaurantSlug !== value.review.restaurant.slug ||
      intentFingerprint(request.items) !==
        intentFingerprint(
          value.review.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            optionIds: item.options.map((option) => option.id),
            ...specialRequestFields(item.notes),
          })),
        )
    )
      return null;
    return { ...value, request };
  } catch {
    return null;
  }
}

export function readStoredSubmission(
  storage: SubmissionStorage,
  scope: CartScope,
): StoredSubmission | null {
  const raw = storage.getItem(submissionStorageKey(scope));
  const attempt = parseStoredSubmission(raw, scope);
  if (raw !== null && !attempt)
    throw new Error(
      "Your saved submission could not be restored. Please ask restaurant staff to check whether your order arrived before trying again.",
    );
  return attempt;
}
export function saveStoredSubmission(
  storage: SubmissionStorage,
  scope: CartScope,
  attempt: StoredSubmission,
) {
  const raw = JSON.stringify(attempt);
  if (!parseStoredSubmission(raw, scope))
    throw new Error("Please review your order again.");
  storage.setItem(submissionStorageKey(scope), raw);
  if (storage.getItem(submissionStorageKey(scope)) !== raw)
    throw new Error("Your browser could not save a safe retry for this order.");
}
export function discardStoredSubmission(
  storage: SubmissionStorage,
  scope: CartScope,
  idempotencyKey: string,
) {
  const current = readStoredSubmission(storage, scope);
  if (current?.request.idempotencyKey === idempotencyKey)
    storage.removeItem(submissionStorageKey(scope));
}

// Modern browsers coordinate tabs through Web Locks. If locking is missing,
// submission is disabled instead of risking competing first-attempt keys.
export async function withSubmissionLock<T>(
  scope: CartScope,
  locks: Pick<LockManager, "request"> | undefined,
  run: () => Promise<T>,
): Promise<T> {
  if (!locks)
    throw new Error(
      "Please use a current version of your browser to place an order safely, or ask our team for help.",
    );
  return locks.request(submissionStorageKey(scope), run);
}

export async function waitForOrderResponse<T>(
  response: Promise<T>,
  timeoutMs = 25000,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      response,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error(
                "The connection is taking longer than expected. Your bag is safe. Retry below so we can check the original order reference.",
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

// Show deliberate customer messages; never surface raw transport/browser errors.
export function submissionFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const customerMessages = [
    "Your saved submission could not be restored.",
    "Please review your order again.",
    "Your browser could not save a safe retry",
    "Please use a current version of your browser",
    "The connection is taking longer than expected.",
    "Your bag has changed.",
    "Your bag changed in another tab.",
    "This review has expired.",
  ];
  if (customerMessages.some((prefix) => message.startsWith(prefix)))
    return message;
  if (
    error instanceof Error &&
    ["SecurityError", "QuotaExceededError"].includes(error.name)
  )
    return "Your browser couldn’t save a safe order reference. Please allow browser storage before trying again; your bag has been kept.";
  return "The connection was interrupted. Your bag is safe. Check and retry using the same order reference.";
}
