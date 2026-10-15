import type { OrderStatus } from "./types";
export type OrderProgress = {
  id: string;
  restaurantId: string;
  status: OrderStatus;
  updatedAt: string;
  cancelReason: string | null;
};
export const progressLabels: Record<OrderStatus, string> = {
  pending: "Waiting for restaurant confirmation",
  accepted: "Your order has been accepted",
  preparing: "Your food is being prepared",
  ready: "Your order is ready",
  served: "Your order has been served",
  cancelled: "Your order was cancelled",
};
