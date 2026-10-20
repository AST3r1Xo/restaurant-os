import { validOrderId } from "../orders/payload.ts";
import { decodeKitchenSnapshot } from "../staff/model.ts";
import type { DailyReport, ReportSelection } from "./types.ts";

export function validReportDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^(20\d{2}|2100)-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
export function parseReportSelection(
  value: Record<string, string | string[] | undefined>,
): ReportSelection {
  const { date, currency, before } = value;
  if (
    (date !== undefined && !validReportDay(date)) ||
    (currency !== undefined &&
      (typeof currency !== "string" ||
        !["EUR", "USD", "GBP"].includes(currency))) ||
    (before !== undefined && !validOrderId(before))
  )
    throw new Error("REPORT_INVALID");
  return {
    ...(date ? { day: date } : {}),
    ...(currency ? { currency } : {}),
    ...(before ? { before } : {}),
  };
}
export function shiftReportDay(day: string, amount: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
export function reportHref(selection: ReportSelection) {
  const query = new URLSearchParams();
  if (selection.day) query.set("date", selection.day);
  if (selection.currency) query.set("currency", selection.currency);
  if (selection.before) query.set("before", selection.before);
  return `/admin/history${query.size ? `?${query}` : ""}`;
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const integer = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
function fail(): never {
  throw new Error("REPORT_UNAVAILABLE");
}
export function decodeDailyReport(
  value: unknown,
  restaurantId: string,
): DailyReport {
  if (
    !record(value) ||
    value.restaurantId !== restaurantId ||
    !validReportDay(value.day) ||
    !validReportDay(value.today) ||
    typeof value.timezone !== "string" ||
    typeof value.fetchedAt !== "string" ||
    !Number.isFinite(Date.parse(value.fetchedAt)) ||
    !["EUR", "USD", "GBP"].includes(value.currency as string) ||
    !Array.isArray(value.currencies) ||
    !value.currencies.length ||
    value.currencies.some((v) => !["EUR", "USD", "GBP"].includes(v)) ||
    new Set(value.currencies).size !== value.currencies.length ||
    !value.currencies.includes(value.currency) ||
    !record(value.totals) ||
    !Array.isArray(value.products) ||
    !Array.isArray(value.orders) ||
    value.orders.length > 40 ||
    !(value.nextCursor === null || validOrderId(value.nextCursor))
  )
    fail();
  try {
    new Intl.DateTimeFormat("en", { timeZone: value.timezone });
  } catch {
    fail();
  }
  const totals = value.totals;
  for (const field of [
    "orderCount",
    "confirmedCount",
    "pendingCount",
    "cancelledCount",
    "servedCount",
    "confirmedMinor",
    "pendingMinor",
    "cancelledMinor",
    "dishCount",
  ])
    if (!integer(totals[field])) fail();
  if (
    totals.orderCount !==
      (totals.confirmedCount as number) +
        (totals.pendingCount as number) +
        (totals.cancelledCount as number) ||
    (totals.servedCount as number) > (totals.confirmedCount as number)
  )
    fail();
  const products = value.products.map((p) => {
    if (
      !record(p) ||
      !validOrderId(p.productId) ||
      typeof p.name !== "string" ||
      !p.name.trim() ||
      p.name.length > 160 ||
      !integer(p.quantity) ||
      !p.quantity ||
      !integer(p.orderCount) ||
      !p.orderCount ||
      p.orderCount > (totals.confirmedCount as number) ||
      !integer(p.totalMinor)
    )
      fail();
    return {
      productId: p.productId,
      name: p.name,
      quantity: p.quantity,
      orderCount: p.orderCount,
      totalMinor: p.totalMinor,
    };
  });
  if (
    new Set(products.map((p) => p.productId)).size !== products.length ||
    products.reduce((s, p) => s + p.quantity, 0) !== totals.dishCount
  )
    fail();
  const snapshot = decodeKitchenSnapshot(
    {
      ...value,
      metrics: {
        pending: 0,
        preparing: 0,
        ready: 0,
        completedToday: 0,
        receivedToday: 0,
      },
    },
    restaurantId,
  );
  if (
    snapshot.orders.length !== value.orders.length ||
    snapshot.orders.some((o) => o.currency !== value.currency) ||
    snapshot.orders.length > (totals.orderCount as number) ||
    (value.nextCursor !== null &&
      snapshot.orders.at(-1)?.id !== value.nextCursor)
  )
    fail();
  return {
    ...value,
    totals,
    products,
    orders: snapshot.orders,
  } as unknown as DailyReport;
}
