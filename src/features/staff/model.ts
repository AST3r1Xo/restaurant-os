import type { KitchenOrder, KitchenSnapshot } from "./types.ts";
import type { OrderStatus } from "../orders/types.ts";
export const statuses: OrderStatus[] = [
  "pending",
  "accepted",
  "preparing",
  "ready",
  "served",
  "cancelled",
];
export const nextActions: Partial<
  Record<OrderStatus, { label: string; status: OrderStatus }>
> = {
  pending: { label: "Ready for service", status: "ready" },
  accepted: { label: "Ready for service", status: "ready" },
  preparing: { label: "Ready for service", status: "ready" },
  ready: { label: "Mark served", status: "served" },
};
export type QueueSection = "active" | "pending" | "preparing" | "ready" | "completed";
export function queueOrders(orders: KitchenOrder[], section: QueueSection) {
  return [
    ...new Map(
      orders
        .filter((o) =>
          section === "active"
            ? ["pending", "accepted", "preparing"].includes(o.status)
            : section === "preparing"
            ? ["accepted", "preparing"].includes(o.status)
            : section === "completed"
              ? ["served", "cancelled"].includes(o.status)
              : o.status === section,
        )
        .map((o) => [o.id, o]),
    ).values(),
  ].sort((a, b) =>
    section === "completed"
      ? b.updatedAt.localeCompare(a.updatedAt)
      : a.createdAt.localeCompare(b.createdAt),
  );
}
function record(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function count(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}
export function decodeKitchenSnapshot(
  value: unknown,
  restaurantId: string,
): KitchenSnapshot {
  if (
    !record(value) ||
    value.restaurantId !== restaurantId ||
    typeof value.timezone !== "string" ||
    typeof value.fetchedAt !== "string" ||
    !record(value.metrics) ||
    !["pending", "preparing", "ready", "completedToday", "receivedToday"].every(
      (k) => count((value.metrics as Record<string, unknown>)[k]),
    ) ||
    !Array.isArray(value.orders) ||
    value.orders.length > 400
  )
    throw new Error("INVALID_SNAPSHOT");
  const snapshot = value as unknown as KitchenSnapshot;
  for (const o of snapshot.orders) {
    if (
      o.restaurantId !== restaurantId ||
      typeof o.id !== "string" ||
      typeof o.reference !== "string" ||
      !statuses.includes(o.status) ||
      !count(o.totalMinor) ||
      !Number.isFinite(Date.parse(o.createdAt)) ||
      !Number.isFinite(Date.parse(o.updatedAt)) ||
      typeof o.tableLabel !== "string" ||
      !Array.isArray(o.items)
    )
      throw new Error("INVALID_SNAPSHOT");
    for (const i of o.items)
      if (
        typeof i.name !== "string" ||
        !count(i.quantity) ||
        i.quantity < 1 ||
        !count(i.unitPriceMinor) ||
        i.lineTotalMinor !== i.quantity * i.unitPriceMinor ||
        !Array.isArray(i.options)
      )
        throw new Error("INVALID_SNAPSHOT");
    if (o.items.reduce((sum, i) => sum + i.lineTotalMinor, 0) !== o.totalMinor)
      throw new Error("INVALID_SNAPSHOT");
  }
  snapshot.orders = [
    ...new Map(snapshot.orders.map((o) => [o.id, o])).values(),
  ];
  return snapshot;
}
