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
  ArrowRight,
  LoaderCircle,
} from "lucide-react";
import { useRealtimeSnapshot } from "@/features/realtime/use-realtime-snapshot";
import { formatMoney } from "@/lib/format";
import { kitchenSnapshotAction, transitionOrderAction } from "../actions";
import { nextActions, queueOrders } from "../model";
import type { QueueSection } from "../model";
import type { KitchenOrder, KitchenSnapshot, StaffRestaurant } from "../types";
import type { OrderStatus } from "@/features/orders/types";
const sections: { id: QueueSection; label: string; icon: typeof Bell }[] = [
  { id: "pending", label: "New orders", icon: Bell },
  { id: "preparing", label: "In preparation", icon: ChefHat },
  { id: "ready", label: "Ready", icon: Check },
  { id: "completed", label: "Completed", icon: Clock3 },
];
const labels: Record<OrderStatus, string> = {
  pending: "Pending acceptance",
  accepted: "Accepted",
  preparing: "Preparing",
  ready: "Ready to serve",
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
      className={`flex flex-col rounded-2xl border bg-white p-5 sm:p-6 ${highlight ? "border-accent shadow-[0_0_0_2px_rgba(49,78,60,.12)]" : "border-line"}`}
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
        className={`mt-4 inline-flex w-fit items-center gap-2 rounded-full px-3 py-2 text-[11px] font-medium ${order.status === "cancelled" ? "bg-red-50 text-red-800" : order.status === "pending" ? "bg-amber-50 text-amber-900" : "bg-accent-soft text-accent"}`}
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
              <div>
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
                  <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs leading-5 text-amber-900">
                    {item.notes}
                  </p>
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
            <button
              disabled={busy || demo}
              onClick={() => void update(action.status)}
              className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy && (
                <LoaderCircle
                  size={16}
                  className="animate-spin"
                  aria-hidden="true"
                />
              )}
              {action.label}
            </button>
            {order.status === "pending" && (
              <button
                disabled={busy || demo}
                onClick={() => setDeclining(!declining)}
                aria-expanded={declining}
                className="min-h-12 rounded-xl border border-line px-4 text-sm font-medium disabled:opacity-50"
              >
                Decline
              </button>
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
              <button
                disabled={busy || reason.trim().length < 2}
                onClick={() => void update("cancelled")}
                className="mt-3 min-h-11 w-full rounded-lg bg-red-800 px-3 text-sm font-medium text-white disabled:opacity-50"
              >
                Confirm decline
              </button>
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
  overview = false,
}: {
  initial: KitchenSnapshot;
  restaurant: StaffRestaurant;
  demo?: boolean;
  overview?: boolean;
}) {
  // Demo is mounted separately, so it never opens Auth or Realtime connections.
  return demo ? (
    <KitchenView
      snapshot={initial}
      restaurant={restaurant}
      demo
      overview={overview}
    />
  ) : (
    <LiveKitchen
      initial={initial}
      restaurant={restaurant}
      overview={overview}
    />
  );
}
function LiveKitchen({
  initial,
  restaurant,
  overview,
}: {
  initial: KitchenSnapshot;
  restaurant: StaffRestaurant;
  overview: boolean;
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
      overview={overview}
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
  overview = false,
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
  overview?: boolean;
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
  const [section, setSection] = useState<QueueSection>("pending");
  const [now, setNow] = useState(Date.parse(snapshot.fetchedAt));
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const metrics = snapshot.metrics;
  const stats = [
    { label: "New orders", value: metrics.pending },
    { label: "In preparation", value: metrics.preparing },
    { label: "Ready to serve", value: metrics.ready },
    { label: "Completed today", value: metrics.completedToday },
    { label: "Received today", value: metrics.receivedToday },
  ];
  const count = (id: QueueSection) =>
    id === "pending"
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
            {overview ? "Service at a glance" : "Service, in sync"}
          </p>
          <h1 className="mt-3 font-display text-4xl sm:text-5xl">
            {overview ? "Your service today." : "The kitchen."}
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            {restaurant.name} ·{" "}
            {demo ? "Sample service only" : "Your team’s live order queue"}
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
              ? "Live connection"
              : "Reconnecting · Automatic checks"}
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
      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-line bg-white p-4 sm:p-5"
          >
            <p className="text-xs text-muted">{stat.label}</p>
            <p className="mt-3 font-display text-4xl tabular-nums">
              {stat.value}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted">
        Today follows {restaurant.timezone}. Completed includes served and
        declined orders.
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
            onClick={() => {
              setSection("pending");
              dismiss?.();
            }}
            className="min-h-11 text-xs font-semibold text-accent underline"
          >
            View new orders
          </button>
        </div>
      )}
      {overview ? (
        <Link
          href="/admin/orders"
          className="mt-8 flex min-h-14 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-medium text-white"
        >
          Open kitchen queue
          <ArrowRight size={17} aria-hidden="true" />
        </Link>
      ) : (
        <>
          <nav
            aria-label="Order queues"
            className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-4"
          >
            {sections.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={section === id}
                onClick={() => setSection(id)}
                className={`flex min-h-14 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-semibold sm:text-sm ${section === id ? "border-accent bg-accent text-white" : "border-line bg-white text-muted"}`}
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
                {section === "pending"
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
      )}
    </div>
  );
}
