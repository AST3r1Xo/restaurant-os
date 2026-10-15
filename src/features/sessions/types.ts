import type { KitchenOrder } from "../staff/types";
import type { OrderStatus } from "../orders/types";
export type SharedBillLine = {
  key: string;
  name: string;
  quantity: number;
  basePriceMinor: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  status: OrderStatus;
  options: { name: string; groupName: string; priceAdjustmentMinor: number }[];
};
export type SessionTotals = {
  orderValueMinor: number;
  confirmedMinor: number;
  pendingMinor: number;
  cancelledMinor: number;
  orderCount: number;
  confirmedCount: number;
  pendingCount: number;
  cancelledCount: number;
  unfinishedCount: number;
};
export type BillRequest = {
  id: string;
  status: "requested" | "acknowledged" | "closed";
  requestedAt: string;
  acknowledgedAt: string | null;
};
export type SessionSummary = {
  currency: string;
  id: string;
  tableId: string;
  tableLabel: string;
  status: "active" | "closed";
  openedAt: string;
  closedAt: string | null;
  updatedAt: string;
  totals: SessionTotals;
  request: BillRequest | null;
};
export type GuestBill = {
  id: string;
  restaurantId: string;
  tableLabel: string;
  currency: string;
  access: "waiting" | "active" | "closed";
  openedAt: string;
  closedAt: string | null;
  fetchedAt: string;
  totals?: SessionTotals;
  lines?: SharedBillLine[];
  request?: BillRequest | null;
};
export type GuestBillSnapshot = {
  restaurantId: string;
  bill: GuestBill | null;
  fetchedAt: string;
};
export type TableWorkspace = {
  restaurantId: string;
  currency: string;
  timezone: string;
  fetchedAt: string;
  tables: {
    id: string;
    label: string;
    isActive: boolean;
    session: SessionSummary | null;
  }[];
  history: SessionSummary[];
  nextCursor: string | null;
  requests: {
    id: string;
    sessionId: string;
    tableId: string;
    tableLabel: string;
    requestedAt: string;
  }[];
};
export type SessionOrders = {
  restaurantId: string;
  sessionId: string;
  orders: KitchenOrder[];
  nextCursor: string | null;
  fetchedAt: string;
};
export type SessionResult<T> =
  { ok: true; value: T } | { ok: false; code: string; message: string };
