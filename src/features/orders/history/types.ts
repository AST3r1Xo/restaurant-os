import type { ConfirmedOrder } from "../types";

export type HistoryOrder = ConfirmedOrder & {
  updatedAt: string;
  cancelReason: string | null;
};
export type GuestOrderHistory = {
  restaurant: ConfirmedOrder["restaurant"];
  currency: string;
  timezone: string;
  fetchedAt: string;
  totals: {
    orderValueMinor: number;
    confirmedMinor: number;
    pendingMinor: number;
    cancelledMinor: number;
    confirmedCount: number;
    pendingCount: number;
    cancelledCount: number;
    orderCount: number;
  };
  orders: HistoryOrder[];
  nextCursor: string | null;
  scope: "visit";
  visit: { id: string; tableLabel: string; openedAt: string } | null;
};
export type HistoryScope = { scope: "visit"; tableToken?: string };
