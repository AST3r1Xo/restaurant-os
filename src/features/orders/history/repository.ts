import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../types/database.ts";
import { decodeConfirmedOrder, OrderRepositoryError } from "../repository.ts";
import { validOrderId, validRestaurantSlug } from "../payload.ts";
import type { GuestOrderHistory, HistoryOrder, HistoryScope } from "./types.ts";

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function date(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    Number.isFinite(Date.parse(value))
  );
}
function invalid(): never {
  throw new OrderRepositoryError("UNAVAILABLE");
}

export function decodeGuestHistory(
  value: unknown,
  slug: string,
): GuestOrderHistory {
  if (
    !record(value) ||
    !record(value.restaurant) ||
    !validOrderId(value.restaurant.id) ||
    value.restaurant.slug !== slug ||
    typeof value.restaurant.name !== "string" ||
    !value.restaurant.name.trim() ||
    value.restaurant.name.length > 120 ||
    !["EUR", "USD", "GBP"].includes(value.currency as string) ||
    typeof value.timezone !== "string" ||
    value.timezone.length > 100 ||
    !date(value.fetchedAt) ||
    !record(value.totals) ||
    !Array.isArray(value.orders) ||
    value.orders.length > 20 ||
    !(value.nextCursor === null || validOrderId(value.nextCursor))
  )
    invalid();
  try {
    new Intl.DateTimeFormat("en", { timeZone: value.timezone });
  } catch {
    invalid();
  }
  const restaurantId = value.restaurant.id;
  const scope = value.scope;
  if (scope !== "visit") invalid();
  let visit: GuestOrderHistory["visit"] = null;
  if (scope === "visit" && value.visit !== null) {
    if (
      !record(value.visit) ||
      !validOrderId(value.visit.id) ||
      typeof value.visit.tableLabel !== "string" ||
      !value.visit.tableLabel.trim() ||
      value.visit.tableLabel.length > 60 ||
      !date(value.visit.openedAt)
    )
      invalid();
    visit = {
      id: value.visit.id,
      tableLabel: value.visit.tableLabel,
      openedAt: value.visit.openedAt,
    };
  }
  const keys = [
    "orderValueMinor",
    "confirmedMinor",
    "pendingMinor",
    "cancelledMinor",
    "confirmedCount",
    "pendingCount",
    "cancelledCount",
    "orderCount",
  ] as const;
  const totals = Object.fromEntries(
    keys.map((key) => {
      const amount = (value.totals as Record<string, unknown>)[key];
      if (!integer(amount)) invalid();
      return [key, amount];
    }),
  ) as GuestOrderHistory["totals"];
  if (
    totals.orderValueMinor !== totals.confirmedMinor + totals.pendingMinor ||
    totals.confirmedCount + totals.pendingCount + totals.cancelledCount !==
      totals.orderCount
  )
    invalid();
  if (scope === "visit" && !visit && totals.orderCount !== 0) invalid();
  const orders: HistoryOrder[] = value.orders.map((raw) => {
    const order = decodeConfirmedOrder(raw, slug);
    if (
      order.restaurant.id !== restaurantId ||
      order.currency !== value.currency ||
      !record(raw) ||
      !date(raw.updatedAt) ||
      !(
        raw.cancelReason === null ||
        (typeof raw.cancelReason === "string" && raw.cancelReason.length <= 300)
      )
    )
      invalid();
    return {
      ...order,
      updatedAt: raw.updatedAt,
      cancelReason: raw.cancelReason,
    };
  });
  if (
    new Set(orders.map((order) => order.id)).size !== orders.length ||
    totals.orderCount < orders.length ||
    (value.nextCursor !== null &&
      (orders.length !== 20 || value.nextCursor !== orders.at(-1)?.id))
  )
    invalid();
  // The visible page is only part of the ledger. Never substitute cart prices.
  for (const [statuses, amountKey, countKey] of [
    [["pending"], "pendingMinor", "pendingCount"],
    [["cancelled"], "cancelledMinor", "cancelledCount"],
    [
      ["accepted", "preparing", "ready", "served"],
      "confirmedMinor",
      "confirmedCount",
    ],
  ] as const) {
    const subset = orders.filter((order) =>
      (statuses as readonly string[]).includes(order.status),
    );
    if (
      subset.length > totals[countKey] ||
      subset.reduce((sum, o) => sum + o.totalMinor, 0) > totals[amountKey]
    )
      invalid();
  }
  return {
    restaurant: { id: value.restaurant.id, slug, name: value.restaurant.name },
    currency: value.currency as string,
    timezone: value.timezone,
    fetchedAt: value.fetchedAt,
    totals,
    orders,
    nextCursor: value.nextCursor,
    scope,
    visit,
  };
}

export async function fetchGuestHistory(
  client: SupabaseClient<Database>,
  slug: string,
  cursor: string | null = null,
  scope: HistoryScope = { scope: "visit" },
) {
  if (!validRestaurantSlug(slug) || (cursor !== null && !validOrderId(cursor)))
    invalid();
  if (
    scope.scope !== "visit" ||
    (scope.tableToken !== undefined && !validOrderId(scope.tableToken))
  )
    invalid();
  const { data, error } = await client.rpc("get_guest_visit_order_history", {
    restaurant_slug: slug,
    ...(cursor ? { before_order_id: cursor } : {}),
    ...(scope.scope === "visit" && scope.tableToken
      ? { table_token: scope.tableToken }
      : {}),
  });
  if (error)
    throw new OrderRepositoryError(
      error.message === "SESSION_REQUIRED" ? "SESSION_REQUIRED" : "UNAVAILABLE",
    );
  const history = data === null ? null : decodeGuestHistory(data, slug);
  if (history && history.scope !== scope.scope) invalid();
  return history;
}

export function mergeHistoryPages(
  pages: GuestOrderHistory[],
): GuestOrderHistory {
  if (!pages.length) invalid();
  const first = pages[0];
  if (
    pages.some(
      (page) =>
        page.restaurant.id !== first.restaurant.id ||
        page.scope !== first.scope ||
        page.visit?.id !== first.visit?.id ||
        page.currency !== first.currency,
    )
  )
    invalid();
  const unique = new Map<string, HistoryOrder>();
  const latest = pages.reduce((current, page) =>
    Date.parse(page.fetchedAt) > Date.parse(current.fetchedAt) ? page : current,
  );
  for (const page of pages)
    for (const order of page.orders) {
      const prior = unique.get(order.id);
      if (!prior || Date.parse(order.updatedAt) > Date.parse(prior.updatedAt))
        unique.set(order.id, order);
    }
  return {
    ...latest,
    orders: [...unique.values()].sort(
      (a, b) =>
        Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
        b.id.localeCompare(a.id),
    ),
    nextCursor: pages.at(-1)!.nextCursor,
  };
}
