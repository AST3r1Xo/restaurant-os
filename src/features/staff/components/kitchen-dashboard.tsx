"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Bell,
  Clock3,
  ChefHat,
  Check,
  Wifi,
  WifiOff,
  LoaderCircle,
} from "lucide-react";
import { useRealtimeSnapshot } from "@/features/realtime/use-realtime-snapshot";
import { formatMoney } from "@/lib/format";
import { kitchenSnapshotAction, transitionOrderAction } from "../actions";
import { nextActions, queueOrders } from "../model";
import type { QueueSection } from "../model";
import type { KitchenOrder, KitchenSnapshot, StaffRestaurant } from "../types";
import type { OrderStatus } from "@/features/orders/types";
import { ActionButton } from "@/components/action-button";
const sections: { id: QueueSection; label: string; icon: typeof Bell }[] = [
  { id: "active", label: "To prepare", icon: ChefHat },
  { id: "ready", label: "Ready for service", icon: Check },
  { id: "completed", label: "Completed", icon: Clock3 },
];
const labels: Record<OrderStatus, string> = {
  pending: "New order",
  accepted: "In kitchen",
  preparing: "In kitchen",
  ready: "Ready for service",
  served: "Served",
  cancelled: "Cancelled",
};
function KitchenCard({
  order,
  timezone,
  now,
  highlight,
  demo,
  onChange,
}: {
  order: KitchenOrder;
  timezone: string;
  now: number;
  highlight: boolean;
  demo: boolean;
  onChange: (
    order: KitchenOrder,
    next: OrderStatus,
    reason?: string,
  ) => Promise<string | undefined>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  async function update(status: OrderStatus) {
    if (busy || demo) return;
    setBusy(true);
    setError(undefined);
    try {
      setError(
        await onChange(
          order,
          status,
          status === "cancelled" ? reason : undefined,
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  const action = nextActions[order.status];
  const age = Math.max(
    0,
    Math.floor((now - Date.parse(order.createdAt)) / 60000),
  );
  return (
    <article
      data-order-id={order.id}
      className={`flex flex-col rounded-2xl border border-t-4 bg-white p-5 sm:p-6 ${highlight ? "shadow-[0_0_0_2px_rgba(49,78,60,.12)]" : ""} ${order.status === "pending" ? "border-line border-t-attention" : order.status === "accepted" || order.status === "preparing" ? "border-line border-t-progress" : order.status === "cancelled" ? "border-line border-t-danger" : "border-line border-t-accent"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
            #{order.reference}
          </p>
          <h2 className="mt-2 font-display text-3xl">{order.tableLabel}</h2>
        </div>
        <div className="text-right">
          <time dateTime={order.createdAt} className="text-sm tabular-nums">
            {new Intl.DateTimeFormat("en-GB", {
              timeZone: timezone,
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date(order.createdAt))}
          </time>
          <p className="mt-1 text-xs tabular-nums text-muted">
            {age < 1 ? "Just arrived" : `${age} min since placed`}
          </p>
        </div>
      </div>
      <span
        className={`mt-4 inline-flex w-fit items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold ${order.status === "cancelled" ? "bg-danger-soft text-danger" : order.status === "pending" ? "bg-attention-soft text-attention" : order.status === "accepted" || order.status === "preparing" ? "bg-progress-soft text-progress" : "bg-accent-soft text-accent"}`}
      >
        <span className="size-1.5 rounded-full bg-current" />
        {labels[order.status]}
        {highlight && " · New"}
      </span>
      <ul className="my-5 space-y-4">
        {order.items.map((item) => (
          <li key={item.id}>
            <div className="flex items-start gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-sm font-semibold tabular-nums">
                {item.quantity}×
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-6">{item.name}</p>
                {item.options.map((option) => (
                  <p
                    key={option.id}
                    className="mt-1 text-xs leading-5 text-muted"
                  >
                    {option.groupName}: {option.name}
                    {option.priceAdjustmentMinor > 0 &&
                      ` (+${formatMoney(option.priceAdjustmentMinor, order.currency)} each)`}
                  </p>
                ))}
                {item.notes && (
                  <div className="mt-2 rounded-xl border border-attention/15 bg-attention-soft px-3 py-2.5 text-sm leading-6 text-attention">
                    <p className="text-xs font-semibold">Special request</p>
                    <p className="whitespace-pre-wrap break-words">{item.notes}</p>
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {order.notes && (
        <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-900">
          {order.notes}
        </p>
      )}
      {order.cancelReason && (
        <p className="mb-4 text-sm leading-6 text-red-800">
          Declined: {order.cancelReason}
        </p>
      )}
      <div className="mt-auto flex items-center justify-between border-t border-line pt-4">
        <span className="text-xs text-muted">Order total</span>
        <span className="text-lg font-medium tabular-nums">
          {formatMoney(order.totalMinor, order.currency)}
        </span>
      </div>
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-900"
        >
          {error}
        </p>
      )}
      {action && (
        <div className="mt-5 space-y-3">
          <div className="flex gap-3">
            <ActionButton
              disabled={busy || demo}
              onClick={() => void update(action.status)}
              tone={order.status === "ready" ? "confirm" : "progress"}
              className="flex-1"
            >
              {busy && (
                <LoaderCircle
                  size={16}
                  className="animate-spin"
                  aria-hidden="true"
                />
              )}
              {action.label}
            </ActionButton>
            {order.status === "pending" && (
              <ActionButton
                disabled={busy || demo}
                onClick={() => setDeclining(!declining)}
                aria-expanded={declining}
                tone="danger"
              >
                Decline
              </ActionButton>
            )}
          </div>
          {declining && order.status === "pending" && (
            <div className="rounded-xl border border-red-100 bg-red-50 p-4">
              <label
                htmlFor={`reason-${order.id}`}
                className="text-xs font-medium text-red-800"
              >
                Reason shown to the customer
              </label>
              <textarea
                id={`reason-${order.id}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={300}
                rows={2}
                className="mt-2 min-h-20 w-full rounded-lg border border-red-200 bg-white p-3 text-sm"
              />
              <ActionButton
                disabled={busy || reason.trim().length < 2}
                onClick={() => void update("cancelled")}
                tone="danger"
                className="mt-3 w-full"
              >
                Confirm decline
              </ActionButton>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
export function KitchenDashboard({
  initial,
  restaurant,
  demo = false,
}: {
  initial: KitchenSnapshot;
  restaurant: StaffRestaurant;
  demo?: boolean;
}) {
  // Demo is mounted separately, so it never opens Auth or Realtime connections.
  return demo ? (
    <KitchenView
      snapshot={initial}
      restaurant={restaurant}
      demo
    />
  ) : (
    <LiveKitchen
      initial={initial}
      restaurant={restaurant}
    />
  );
}
function LiveKitchen({
  initial,
  restaurant,
}: {
  initial: KitchenSnapshot;
  restaurant: StaffRestaurant;
}) {
  const [highlight, setHighlight] = useState<string[]>([]);
  const [actionNotice, setActionNotice] = useState<string>();
  const known = useRef(new Set(initial.orders.map((o) => o.id)));
  const tracking = useRealtimeSnapshot(
    initial,
    { audience: "staff", restaurantId: restaurant.id },
    async () => {
      const result = await kitchenSnapshotAction(restaurant.id);
      if (!result.ok) return result;
      const arrivals = result.snapshot.orders.filter(
        (o) => o.status === "pending" && !known.current.has(o.id),
      );
      result.snapshot.orders.forEach((o) => known.current.add(o.id));
      if (arrivals.length)
        setHighlight((old) => [
          ...new Set([...old, ...arrivals.map((o) => o.id)]),
        ]);
      return { ok: true, value: result.snapshot };
    },
  );
  async function change(
    order: KitchenOrder,
    next: OrderStatus,
    reason?: string,
  ): Promise<string | undefined> {
    setActionNotice(undefined);
    try {
      const result = await transitionOrderAction({
        restaurantId: restaurant.id,
        orderId: order.id,
        expectedStatus: order.status,
        nextStatus: next,
        reason,
      });
      if (result.ok) {
        tracking.setValue(result.snapshot);
        setHighlight((old) => old.filter((id) => id !== order.id));
        return;
      }
      await tracking.refresh();
      setActionNotice(result.message);
      return;
    } catch {
      await tracking.refresh();
      setActionNotice(
        "The connection was interrupted. Check the latest order status before retrying.",
      );
      return;
    }
  }
  if (tracking.denied)
    return (
      <div
        role="alert"
        className="rounded-2xl border border-amber-200 bg-amber-50 p-6"
      >
        <p>{tracking.error}</p>
        <Link
          href="/admin/login"
          className="mt-3 inline-flex min-h-11 items-center text-sm underline"
        >
          Sign in again
        </Link>
      </div>
    );
  return (
    <KitchenView
      snapshot={tracking.value}
      restaurant={restaurant}
      connection={tracking.connection}
      error={tracking.error ?? actionNotice}
      highlight={highlight}
      dismiss={() => setHighlight([])}
      onChange={change}
      refresh={async () => {
        setActionNotice(undefined);
        await tracking.refresh();
      }}
    />
  );
}
function KitchenView({
  snapshot,
  restaurant,
  demo = false,
  connection = "live",
  error,
  highlight = [],
  dismiss,
  onChange,
  refresh,
}: {
  snapshot: KitchenSnapshot;
  restaurant: StaffRestaurant;
  demo?: boolean;
  connection?: "live" | "connecting" | "offline";
  error?: string;
  highlight?: string[];
  dismiss?: () => void;
  onChange?: (
    o: KitchenOrder,
    s: OrderStatus,
    r?: string,
  ) => Promise<string | undefined>;
  refresh?: () => Promise<void>;
}) {
  const [section, setSection] = useState<QueueSection>("active");
  const [now, setNow] = useState(Date.parse(snapshot.fetchedAt));
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const metrics = snapshot.metrics;
  const count = (id: QueueSection) =>
    id === "active"
      ? metrics.pending + metrics.preparing
      : id === "pending"
      ? metrics.pending
      : id === "preparing"
        ? metrics.preparing
        : id === "ready"
          ? metrics.ready
          : metrics.completedToday;
  const visible = queueOrders(snapshot.orders, section);
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
            Kitchen
          </p>
          <h1 className="mt-3 font-display text-4xl sm:text-5xl">
            Orders
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            {restaurant.name} ·{" "}
            {demo ? "Sample orders" : "Mark dishes ready, then mark them served when they reach the table."}
          </p>
        </div>
        <span
          data-testid="realtime-connection"
          className="flex min-h-11 items-center gap-2 rounded-full border border-line bg-white px-4 text-xs text-muted"
        >
          {connection === "live" && !demo ? (
            <Wifi size={14} aria-hidden="true" />
          ) : (
            <WifiOff size={14} aria-hidden="true" />
          )}
          {demo
            ? "Demo · No live events"
            : connection === "live"
              ? "Updates automatically"
              : "Reconnecting…"}
        </span>
      </div>
      {error && (
        <p
          role="status"
          className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"
        >
          {error}{" "}
          <button
            onClick={() => void refresh?.()}
            className="min-h-11 underline"
          >
            Check again
          </button>
        </p>
      )}
      <p className="mt-5 text-sm text-muted">
        {metrics.receivedToday} orders today · {metrics.completedToday} completed
        <span className="sr-only"> · Today follows {restaurant.timezone}; completed includes served and declined orders.</span>
      </p>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
        Ready for service is for your team only. Hold dishes here until the table
        can be served together. Customers receive no ready-to-eat alert or timer.
      </p>
      {highlight.length > 0 && (
        <div
          role="status"
          className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/20 bg-accent-soft px-5 py-3"
        >
          <p className="flex items-center gap-2 text-sm font-medium text-accent">
            <Bell size={17} aria-hidden="true" />
            {highlight.length} new {highlight.length === 1 ? "order" : "orders"}{" "}
            received
          </p>
          <button
            hidden={section === "active"}
            onClick={() => {
              setSection("active");
              dismiss?.();
            }}
            className="min-h-11 text-xs font-semibold text-accent underline"
          >
            View new orders
          </button>
        </div>
      )}
      <>
        <nav
          aria-label="Order queues"
            className="mt-8 grid grid-cols-1 gap-2 sm:grid-cols-3"
        >
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={section === id}
              onClick={() => setSection(id)}
              className={`flex min-h-16 flex-wrap items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold ${section === id ? id === "active" ? "border-progress bg-progress text-white" : id === "ready" ? "border-attention bg-attention text-white" : "border-accent bg-accent text-white" : "border-line bg-white text-foreground"}`}
            >
              <Icon size={17} aria-hidden="true" />
              {label}
              <span className="rounded-full bg-current/10 px-2 py-0.5 tabular-nums">
                {count(id)}
              </span>
            </button>
          ))}
        </nav>
        {visible.length < count(section) && (
          <p role="status" className="mt-4 text-xs text-muted">
            Showing {visible.length} of {count(section)} orders. Active queues
            show the oldest 300; completed shows the latest 100 today.
          </p>
        )}
        {visible.length ? (
          <div className="mt-6 grid items-stretch gap-5 md:grid-cols-2 2xl:grid-cols-3">
            {visible.map((order) => (
              <KitchenCard
                key={order.id}
                order={order}
                timezone={restaurant.timezone}
                now={now}
                highlight={highlight.includes(order.id)}
                demo={demo}
                onChange={onChange ?? (async () => undefined)}
              />
            ))}
          </div>
        ) : (
          <div
            role="status"
            className="mt-6 rounded-2xl border border-dashed border-line py-16 text-center"
          >
            <ChefHat
              size={28}
              className="mx-auto text-accent"
              aria-hidden="true"
            />
            <h2 className="mt-5 font-display text-2xl">
              {section === "active"
                ? "Ready for the next order."
                : "A clear queue."}
            </h2>
            <p className="mt-3 px-5 text-sm text-muted">
              {section === "completed"
                ? "Completed orders from today will appear here."
                : "Orders appear here automatically as service progresses."}
            </p>
          </div>
        )}
      </>
    </div>
  );
}
