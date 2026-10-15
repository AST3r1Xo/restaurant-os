import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database.ts";
import { validOrderId, validRestaurantSlug } from "../orders/payload.ts";
import { decodeKitchenSnapshot } from "../staff/model.ts";
import type {
  BillRequest,
  GuestBill,
  GuestBillSnapshot,
  SessionOrders,
  SessionSummary,
  SessionTotals,
  SharedBillLine,
  TableWorkspace,
} from "./types.ts";
export class SessionError extends Error {
  readonly code: string;
  constructor(code: string) {
    super("The table session request could not be completed.");
    this.code = code;
  }
}
function invalid(): never {
  throw new SessionError("UNAVAILABLE");
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = 160): v is string =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;
const date = (v: unknown): v is string =>
  typeof v === "string" && v.length < 65 && Number.isFinite(Date.parse(v));
const count = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const currency = (v: unknown): v is string =>
  ["EUR", "GBP", "USD"].includes(v as string);
export function decodeTotals(v: unknown): SessionTotals {
  if (
    !record(v) ||
    ![
      "orderValueMinor",
      "confirmedMinor",
      "pendingMinor",
      "cancelledMinor",
      "orderCount",
      "confirmedCount",
      "pendingCount",
      "cancelledCount",
      "unfinishedCount",
    ].every((k) => count(v[k]))
  )
    invalid();
  const t = v as unknown as SessionTotals;
  if (
    t.orderValueMinor !== t.confirmedMinor + t.pendingMinor ||
    t.orderCount !== t.confirmedCount + t.pendingCount + t.cancelledCount ||
    t.unfinishedCount > t.orderCount
  )
    invalid();
  return t;
}
function request(v: unknown): BillRequest | null {
  if (v === null) return null;
  if (
    !record(v) ||
    !validOrderId(v.id) ||
    !["requested", "acknowledged", "closed"].includes(v.status as string) ||
    !date(v.requestedAt) ||
    !(v.acknowledgedAt === null || date(v.acknowledgedAt))
  )
    invalid();
  if (v.status === "acknowledged" && !v.acknowledgedAt) invalid();
  return {
    id: v.id,
    status: v.status as BillRequest["status"],
    requestedAt: v.requestedAt,
    acknowledgedAt: v.acknowledgedAt,
  };
}
function sharedLines(value: unknown, totals: SessionTotals): SharedBillLine[] {
  if (!Array.isArray(value)) invalid();
  const lines = value.map((v): SharedBillLine => {
    if (
      !record(v) ||
      typeof v.key !== "string" ||
      !/^[a-f0-9]{32}$/.test(v.key) ||
      !text(v.name, 160) ||
      !count(v.quantity) ||
      v.quantity === 0 ||
      !count(v.basePriceMinor) ||
      !count(v.unitPriceMinor) ||
      !count(v.lineTotalMinor) ||
      ![
        "pending",
        "accepted",
        "preparing",
        "ready",
        "served",
        "cancelled",
      ].includes(v.status as string) ||
      !Array.isArray(v.options) ||
      v.options.length > 50
    )
      invalid();
    const options = v.options.map((o) => {
      if (
        !record(o) ||
        !text(o.name, 160) ||
        !text(o.groupName, 160) ||
        !count(o.priceAdjustmentMinor)
      )
        invalid();
      return {
        name: o.name,
        groupName: o.groupName,
        priceAdjustmentMinor: o.priceAdjustmentMinor,
      };
    });
    if (
      v.unitPriceMinor !==
        v.basePriceMinor +
          options.reduce((sum, o) => sum + o.priceAdjustmentMinor, 0) ||
      !Number.isSafeInteger(v.unitPriceMinor * v.quantity) ||
      v.lineTotalMinor !== v.unitPriceMinor * v.quantity
    )
      invalid();
    return {
      key: v.key,
      name: v.name,
      quantity: v.quantity,
      basePriceMinor: v.basePriceMinor,
      unitPriceMinor: v.unitPriceMinor,
      lineTotalMinor: v.lineTotalMinor,
      status: v.status as SharedBillLine["status"],
      options,
    };
  });
  if (new Set(lines.map((l) => l.key)).size !== lines.length) invalid();
  for (const [statuses, key] of [
    [["pending"], "pendingMinor"],
    [["cancelled"], "cancelledMinor"],
    [["accepted", "preparing", "ready", "served"], "confirmedMinor"],
  ] as const) {
    const sum = lines
      .filter((l) => (statuses as readonly string[]).includes(l.status))
      .reduce((s, l) => s + l.lineTotalMinor, 0);
    if (!Number.isSafeInteger(sum) || sum !== totals[key]) invalid();
  }
  return lines;
}
export function decodeGuestBill(
  value: unknown,
  restaurantId: string,
): GuestBill | null {
  if (value === null) return null;
  if (
    !record(value) ||
    !validOrderId(value.id) ||
    value.restaurantId !== restaurantId ||
    !text(value.tableLabel, 60) ||
    !currency(value.currency) ||
    !["waiting", "active", "closed"].includes(value.access as string) ||
    !date(value.openedAt) ||
    !date(value.fetchedAt) ||
    !(value.closedAt === null || date(value.closedAt))
  )
    invalid();
  if ((value.access === "closed") !== (value.closedAt !== null)) invalid();
  const base: GuestBill = {
    id: value.id,
    restaurantId,
    tableLabel: value.tableLabel,
    currency: value.currency,
    access: value.access as GuestBill["access"],
    openedAt: value.openedAt,
    closedAt: value.closedAt,
    fetchedAt: value.fetchedAt,
  };
  if (value.access === "active") {
    const totals = decodeTotals(value.totals);
    return {
      ...base,
      totals,
      lines: sharedLines(value.lines, totals),
      request: request(value.request),
    };
  }
  if (
    value.totals !== undefined ||
    value.lines !== undefined ||
    value.request !== undefined ||
    (value.access === "closed" && !value.closedAt)
  )
    invalid();
  return base;
}
function summary(v: unknown): SessionSummary {
  if (
    !record(v) ||
    !validOrderId(v.id) ||
    !validOrderId(v.tableId) ||
    !currency(v.currency) ||
    !text(v.tableLabel, 60) ||
    !["active", "closed"].includes(v.status as string) ||
    !date(v.openedAt) ||
    !date(v.updatedAt) ||
    !(v.closedAt === null || date(v.closedAt))
  )
    invalid();
  if ((v.status === "closed") !== (v.closedAt !== null)) invalid();
  return {
    ...v,
    totals: decodeTotals(v.totals),
    request: request(v.request),
  } as SessionSummary;
}
export function decodeWorkspace(
  v: unknown,
  restaurantId: string,
): TableWorkspace {
  if (
    !record(v) ||
    v.restaurantId !== restaurantId ||
    !currency(v.currency) ||
    !text(v.timezone, 100) ||
    !date(v.fetchedAt) ||
    !Array.isArray(v.tables) ||
    !Array.isArray(v.history) ||
    v.history.length > 20 ||
    !Array.isArray(v.requests) ||
    !(v.nextCursor === null || validOrderId(v.nextCursor))
  )
    invalid();
  try {
    new Intl.DateTimeFormat("en", { timeZone: v.timezone });
  } catch {
    invalid();
  }
  const tables = v.tables.map((t) => {
    if (
      !record(t) ||
      !validOrderId(t.id) ||
      !text(t.label, 60) ||
      typeof t.isActive !== "boolean"
    )
      invalid();
    const s = t.session === null ? null : summary(t.session);
    if (s && (s.tableId !== t.id || s.status !== "active")) invalid();
    return { id: t.id, label: t.label, isActive: t.isActive, session: s };
  });
  const history = v.history.map(summary);
  if (
    history.some((s) => s.status !== "closed") ||
    new Set(tables.map((t) => t.id)).size !== tables.length
  )
    invalid();
  const requests = v.requests.map((r) => {
    if (
      !record(r) ||
      !validOrderId(r.id) ||
      !validOrderId(r.sessionId) ||
      !validOrderId(r.tableId) ||
      !text(r.tableLabel, 60) ||
      !date(r.requestedAt)
    )
      invalid();
    return r as TableWorkspace["requests"][number];
  });
  return { ...v, tables, history, requests } as TableWorkspace;
}
const known = new Set([
  "SESSION_REQUIRED",
  "STAFF_REQUIRED",
  "STAFF_FORBIDDEN",
  "PARTICIPATION_REQUIRED",
  "TABLE_INVALID",
  "SESSION_CLOSED",
  "ACTIVE_ORDERS",
  "REQUEST_UNACKNOWLEDGED",
  "REQUEST_NOT_FOUND",
  "SESSION_NOT_FOUND",
  "INVALID_REQUEST",
  "RATE_LIMITED",
]);
function check(error: { code?: string; message?: string } | null) {
  if (error)
    throw new SessionError(
      error.code === "P0001" && known.has(error.message ?? "")
        ? error.message!
        : "UNAVAILABLE",
    );
}
export async function fetchGuestBill(
  client: SupabaseClient<Database>,
  slug: string,
  restaurantId: string,
  token?: string,
): Promise<GuestBillSnapshot> {
  if (
    !validRestaurantSlug(slug) ||
    !validOrderId(restaurantId) ||
    (token !== undefined && !validOrderId(token))
  )
    throw new SessionError("INVALID_REQUEST");
  const { data, error } = await client.rpc("get_guest_table_bill", {
    restaurant_slug: slug,
    ...(token ? { table_token: token } : {}),
  });
  check(error);
  const bill = decodeGuestBill(data, restaurantId);
  return {
    restaurantId,
    bill,
    fetchedAt: bill?.fetchedAt ?? new Date().toISOString(),
  };
}
export async function fetchWorkspace(
  client: SupabaseClient<Database>,
  id: string,
  cursor?: string,
) {
  if (!validOrderId(id) || (cursor !== undefined && !validOrderId(cursor)))
    throw new SessionError("INVALID_REQUEST");
  const { data, error } = await client.rpc("get_table_workspace", {
    target_restaurant: id,
    ...(cursor ? { before_session: cursor } : {}),
  });
  check(error);
  return decodeWorkspace(data, id);
}
export async function fetchSessionOrders(
  client: SupabaseClient<Database>,
  id: string,
  sessionId: string,
  cursor?: string,
): Promise<SessionOrders> {
  if (
    !validOrderId(id) ||
    !validOrderId(sessionId) ||
    (cursor !== undefined && !validOrderId(cursor))
  )
    throw new SessionError("INVALID_REQUEST");
  const { data, error } = await client.rpc("get_staff_session_orders", {
    target_restaurant: id,
    target_session: sessionId,
    ...(cursor ? { before_order: cursor } : {}),
  });
  check(error);
  if (
    !record(data) ||
    data.restaurantId !== id ||
    data.sessionId !== sessionId ||
    !date(data.fetchedAt) ||
    !(data.nextCursor === null || validOrderId(data.nextCursor)) ||
    !Array.isArray(data.orders) ||
    data.orders.length > 20
  )
    invalid();
  const decoded = decodeKitchenSnapshot(
    {
      ...data,
      timezone: "UTC",
      metrics: {
        pending: 0,
        preparing: 0,
        ready: 0,
        completedToday: 0,
        receivedToday: 0,
      },
    },
    id,
  );
  return { ...data, orders: decoded.orders } as SessionOrders;
}
