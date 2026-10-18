import type { OrderStatus } from "./types";
export type OrderProgress = {
  id: string;
  restaurantId: string;
  status: OrderStatus;
  updatedAt: string;
  cancelReason: string | null;
};
export const progressLabels: Record<OrderStatus, string> = {
  pending: "Order sent to the restaurant",
  accepted: "Order sent to the restaurant",
  preparing: "Order sent to the restaurant",
  ready: "Order sent to the restaurant",
  served: "Your order has been served",
  cancelled: "Your order was cancelled",
};

// Kitchen milestones do not promise serving order or timing to a diner.
export function customerOrderLabel(status: OrderStatus) {
  return status === "cancelled" ? "Cancelled" : status === "served" ? "Served" : "Order sent";
}
