import type { Database } from "@/types/database";

export type OrderStatus = Database["public"]["Enums"]["order_status"];

// Centralized receipt labels; PostgreSQL enforces operational transitions.
export const orderStatusLabels: Record<OrderStatus, string> = {
  pending: "Pending restaurant acceptance",
  accepted: "Accepted by the kitchen",
  preparing: "Being prepared",
  ready: "Ready to serve",
  served: "Served",
  cancelled: "Cancelled",
};

export type OrderOption = {
  id: string;
  groupId: string;
  groupName: string;
  name: string;
  priceAdjustmentMinor: number;
};
export type OrderLine = {
  productId: string;
  productName: string;
  quantity: number;
  basePriceMinor: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  options: OrderOption[];
};
type OrderSummary = {
  restaurant: { id: string; slug: string; name: string };
  table: { label: string };
  currency: string;
  items: OrderLine[];
  totalMinor: number;
};
export type OrderReview = OrderSummary & {
  reviewId: string;
  expiresAt: string;
};
export type ConfirmedOrder = OrderSummary & {
  id: string;
  reference: string;
  status: OrderStatus;
  createdAt: string;
  subtotalMinor: number;
};
export type OrderErrorCode =
  | "invalid_request"
  | "demo"
  | "session_lost"
  | "session_unavailable"
  | "restaurant_unavailable"
  | "table_invalid"
  | "product_unavailable"
  | "options_invalid"
  | "quantity_invalid"
  | "review_expired"
  | "order_changed"
  | "session_changed"
  | "visit_ended"
  | "idempotency_conflict"
  | "rate_limited"
  | "unavailable";
export type OrderFailure = {
  ok: false;
  code: OrderErrorCode;
  message: string;
  refresh?: boolean;
};
export type OrderResult<T> = ({ ok: true } & T) | OrderFailure;
