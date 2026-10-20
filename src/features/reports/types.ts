import type { KitchenOrder } from "../staff/types.ts";

export type DailyProduct = {
  productId: string;
  name: string;
  quantity: number;
  orderCount: number;
  totalMinor: number;
};
export type DailyReport = {
  restaurantId: string;
  day: string;
  today: string;
  timezone: string;
  currency: string;
  currencies: string[];
  fetchedAt: string;
  totals: {
    orderCount: number;
    confirmedCount: number;
    pendingCount: number;
    cancelledCount: number;
    servedCount: number;
    confirmedMinor: number;
    pendingMinor: number;
    cancelledMinor: number;
    dishCount: number;
  };
  products: DailyProduct[];
  orders: KitchenOrder[];
  nextCursor: string | null;
};
export type ReportSelection = {
  day?: string;
  currency?: string;
  before?: string;
};
