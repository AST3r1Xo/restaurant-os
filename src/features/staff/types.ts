import type { OrderOption, OrderStatus } from "../orders/types";
export type StaffRestaurant = {
  id: string;
  slug: string;
  name: string;
  currency: string;
  timezone: string;
  role: "owner" | "manager" | "staff";
};
export type KitchenOrder = {
  id: string;
  reference: string;
  restaurantId: string;
  tableLabel: string;
  status: OrderStatus;
  currency: string;
  totalMinor: number;
  createdAt: string;
  updatedAt: string;
  notes: string;
  cancelReason: string | null;
  items: {
    id: string;
    name: string;
    quantity: number;
    unitPriceMinor: number;
    lineTotalMinor: number;
    options: OrderOption[];
    notes: string;
  }[];
};
export type KitchenSnapshot = {
  restaurantId: string;
  timezone: string;
  orders: KitchenOrder[];
  metrics: {
    pending: number;
    preparing: number;
    ready: number;
    completedToday: number;
    receivedToday: number;
  };
  fetchedAt: string;
};
export type StaffResult<T> =
  | ({ ok: true } & T)
  | {
      ok: false;
      code:
        | "session"
        | "membership"
        | "conflict"
        | "invalid"
        | "unavailable"
        | "workspace";
      message: string;
    };
