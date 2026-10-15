import { GuestSessionError } from "./guest-auth.ts";
import { InvalidOrderPayload } from "./payload.ts";
import { OrderRepositoryError } from "./repository.ts";
import type { OrderFailure } from "./types.ts";

const databaseFailures: Record<string, Omit<OrderFailure, "ok">> = {
  INVALID_REQUEST: {
    code: "invalid_request",
    message: "Please review your bag before placing this order.",
  },
  SESSION_REQUIRED: {
    code: "session_lost",
    message:
      "Your guest session has ended. We can’t safely retry this order. Please ask the restaurant to check whether it was received.",
  },
  RESTAURANT_UNAVAILABLE: {
    code: "restaurant_unavailable",
    message:
      "This restaurant isn’t accepting orders right now. Your bag has been kept.",
  },
  TABLE_INVALID: {
    code: "table_invalid",
    message:
      "This table code is no longer active. Please scan your table’s QR code again.",
  },
  PRODUCT_UNAVAILABLE: {
    code: "product_unavailable",
    message:
      "Unfortunately, an item is no longer available. Please update your bag.",
    refresh: true,
  },
  OPTIONS_INVALID: {
    code: "options_invalid",
    message:
      "One of your customizations is no longer available. Please update your selection.",
    refresh: true,
  },
  QUANTITY_INVALID: {
    code: "quantity_invalid",
    message:
      "Please check your quantities. Each dish allows 1–99, with up to 500 items per order.",
  },
  REVIEW_EXPIRED: {
    code: "review_expired",
    message:
      "Your review has expired. Check the current menu and review your order again.",
    refresh: true,
  },
  ORDER_CHANGED: {
    code: "order_changed",
    message:
      "The menu or prices have changed. Please review your updated order before confirming.",
    refresh: true,
  },
  SESSION_CHANGED: {
    code: "session_changed",
    message:
      "This visit has ended. Scan your table QR to start fresh; previous selections cannot be submitted.",
    refresh: true,
  },
  VISIT_ENDED: {
    code: "visit_ended",
    message:
      "This visit has ended. Its orders are no longer available to customers. Ask restaurant staff for assistance.",
    refresh: true,
  },
  IDEMPOTENCY_CONFLICT: {
    code: "idempotency_conflict",
    message:
      "This submission is already associated with a different order. Please check the original result before trying again.",
  },
  RATE_LIMITED: {
    code: "rate_limited",
    message:
      "There have been several recent requests. Please wait a moment and try again; your bag has been kept.",
  },
};
export function orderFailure(error: unknown): OrderFailure {
  if (error instanceof InvalidOrderPayload)
    return { ok: false, ...databaseFailures.INVALID_REQUEST };
  if (error instanceof GuestSessionError) {
    if (error.reason === "lost")
      return { ok: false, ...databaseFailures.SESSION_REQUIRED };
    return {
      ok: false,
      code: "session_unavailable",
      message:
        "We couldn’t verify your guest session. Please try again in a moment.",
    };
  }
  if (error instanceof OrderRepositoryError && databaseFailures[error.reason])
    return { ok: false, ...databaseFailures[error.reason] };
  return {
    ok: false,
    code: "unavailable",
    message:
      "We couldn’t confirm the result. Your bag is safe. Retry to check the same submission without placing a duplicate order.",
  };
}
