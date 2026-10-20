import type { DailyReport } from "./types.ts";
import { demoStaffRestaurant } from "../staff/demo-data.ts";
import { validReportDay } from "./model.ts";

// Explicit sample metrics only; never a live-query fallback or database write.
export function demoDailyReport(selectedDay?: string): DailyReport {
  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: demoStaffRestaurant.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const day = selectedDay && validReportDay(selectedDay) ? selectedDay : today;
  const samples = [
    { id: "sample-1", name: "Smoked salmon eggs", price: 1650 },
    { id: "sample-2", name: "Smash burger", price: 1500 },
    { id: "sample-3", name: "Fresh orange juice", price: 450 },
    { id: "sample-4", name: "Wild mushroom pasta", price: 1700 },
    { id: "sample-5", name: "Basque cheesecake", price: 650 },
  ];
  const orders = Array.from({ length: 24 }, (_, i) => {
    const p = samples[i % samples.length],
      quantity = 1 + (i % 3);
    const status =
      i < 18 ? "served" : i < 20 ? "ready" : i < 22 ? "pending" : "cancelled";
    return {
      id: `demo-history-${i}`,
      reference: `SAMPLE${String(i + 1).padStart(3, "0")}`,
      restaurantId: demoStaffRestaurant.id,
      tableLabel: `Table 0${1 + (i % 5)}`,
      status: status as "served" | "ready" | "pending" | "cancelled",
      currency: "EUR",
      totalMinor: p.price * quantity,
      createdAt: `${day}T${String(10 + (i % 12)).padStart(2, "0")}:15:00Z`,
      updatedAt: `${day}T22:00:00Z`,
      notes: "",
      cancelReason: status === "cancelled" ? "Sample cancellation" : null,
      items: [
        {
          id: p.id,
          name: p.name,
          quantity,
          unitPriceMinor: p.price,
          lineTotalMinor: p.price * quantity,
          options: [],
          notes: "",
        },
      ],
    };
  }).sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
  const confirmed = orders.filter((o) =>
    ["ready", "served"].includes(o.status),
  );
  const sum = (status: string) =>
    orders
      .filter((o) => o.status === status)
      .reduce((n, o) => n + o.totalMinor, 0);
  return {
    restaurantId: demoStaffRestaurant.id,
    day,
    today,
    timezone: demoStaffRestaurant.timezone,
    currency: "EUR",
    currencies: ["EUR"],
    fetchedAt: now.toISOString(),
    totals: {
      orderCount: 24,
      confirmedCount: 20,
      pendingCount: 2,
      cancelledCount: 2,
      servedCount: 18,
      confirmedMinor: confirmed.reduce((n, o) => n + o.totalMinor, 0),
      pendingMinor: sum("pending"),
      cancelledMinor: sum("cancelled"),
      dishCount: confirmed.reduce((n, o) => n + o.items[0].quantity, 0),
    },
    products: samples.map((p) => {
      const matching = confirmed.filter((o) => o.items[0].id === p.id);
      return {
        productId: p.id,
        name: p.name,
        quantity: matching.reduce((n, o) => n + o.items[0].quantity, 0),
        orderCount: matching.length,
        totalMinor: matching.reduce((n, o) => n + o.totalMinor, 0),
      };
    }),
    orders,
    nextCursor: null,
  };
}
