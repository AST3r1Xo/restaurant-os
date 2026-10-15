"use client";
import { useEffect, useRef, useState } from "react";
import { sessionOrdersAction } from "../actions";
import { useRealtimeSnapshot } from "@/features/realtime/use-realtime-snapshot";
import { OrderSummary } from "@/features/orders/components/order-summary";
import { orderStatusLabels } from "@/features/orders/types";
import type { SessionOrders, SessionSummary } from "../types";
function LiveOrders({ initial }: { initial: SessionOrders }) {
  const pages = useRef(1);
  const paging = useRef(false);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState<string>(),
    [lost, setLost] = useState(false);
  const load = async (count = pages.current) => {
    const first = await sessionOrdersAction(
      initial.restaurantId,
      initial.sessionId,
    );
    if (!first.ok) return first;
    let snapshot = first.value;
    const orders = new Map(snapshot.orders.map((order) => [order.id, order]));
    for (let page = 1; page < count && snapshot.nextCursor; page++) {
      const next = await sessionOrdersAction(
        initial.restaurantId,
        initial.sessionId,
        snapshot.nextCursor,
      );
      if (!next.ok) return next;
      snapshot = next.value;
      for (const order of snapshot.orders) orders.set(order.id, order);
    }
    return {
      ok: true as const,
      value: { ...snapshot, orders: [...orders.values()] },
    };
  };
  const { value, error, denied, refresh, setValue } = useRealtimeSnapshot(
    initial,
    { audience: "staff-tables", restaurantId: initial.restaurantId },
    load,
  );
  const next = value.nextCursor;
  async function more() {
    if (paging.current || !next) return;
    paging.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await load(pages.current + 1);
      if (result.ok) {
        pages.current++;
        setValue(result.value);
        void refresh();
      } else {
        setMessage(result.message);
        if (["session", "membership", "workspace"].includes(result.code))
          setLost(true);
      }
    } catch {
      setMessage("Older orders couldn’t be loaded. Please retry.");
    } finally {
      paging.current = false;
      setBusy(false);
    }
  }
  if (denied || lost)
    return (
      <p role="alert" className="text-sm text-red-800">
        Session access could not be verified.
      </p>
    );
  const orders = [...value.orders].sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
  return (
    <>
      {(error || message) && (
        <p role="alert" className="mb-4 text-xs leading-6 text-amber-900">
          {message ?? error}
        </p>
      )}
      {!orders.length ? (
        <p className="rounded-2xl border border-line bg-white p-6 text-sm text-muted">
          No orders have been placed in this session. Earlier visits are
          excluded.
        </p>
      ) : (
        <div className="space-y-5">
          {orders.map((o) => (
            <details
              key={o.id}
              className="rounded-2xl border border-line bg-white p-4"
            >
              <summary className="min-h-12 cursor-pointer text-sm font-medium">
                Order #{o.reference}{" "}
                <span className="ml-2 text-xs text-muted">
                  {orderStatusLabels[o.status]}
                </span>
              </summary>
              <div className="mt-4">
                <OrderSummary
                  lines={o.items.map((i) => ({
                    key: i.id,
                    name: i.name,
                    quantity: i.quantity,
                    unitPriceMinor: i.unitPriceMinor,
                    totalMinor: i.lineTotalMinor,
                    options: i.options.map((option) => ({
                      ...option,
                      group: option.groupName,
                    })),
                  }))}
                  currency={o.currency}
                  totalMinor={o.totalMinor}
                />
                {o.notes && (
                  <p className="mt-3 text-xs leading-6 text-muted">
                    Instructions: {o.notes}
                  </p>
                )}
                {o.cancelReason && (
                  <p className="mt-3 text-xs leading-6 text-red-800">
                    {o.cancelReason}
                  </p>
                )}
              </div>
            </details>
          ))}
        </div>
      )}
      {next && (
        <button
          onClick={() => void more()}
          disabled={busy}
          className="mt-4 min-h-12 rounded-full border border-line bg-white px-5 text-xs text-accent"
        >
          {busy ? "Loading…" : "Show older session orders"}
        </button>
      )}
      <button
        onClick={() => {
          setMessage(undefined);
          void refresh();
        }}
        className="mt-4 ml-3 min-h-12 px-3 text-xs text-accent"
      >
        Refresh session orders
      </button>
    </>
  );
}
export function SessionOrderList({
  restaurantId,
  session,
}: {
  restaurantId: string;
  session: SessionSummary;
}) {
  const [initial, setInitial] = useState<SessionOrders>(),
    [error, setError] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    void sessionOrdersAction(restaurantId, session.id)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setInitial(result.value);
        else setError(result.message);
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "Session orders could not be loaded. Close and reopen the details to retry.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [restaurantId, session.id]);
  return (
    <section
      aria-label="Itemized session orders"
      className="mt-6 rounded-3xl border border-line bg-[#efeee5] p-5 sm:p-7"
    >
      <h2 className="font-display text-2xl">
        {session.tableLabel} · Session orders
      </h2>
      <p className="mb-5 mt-2 text-xs leading-6 text-muted">
        Only orders explicitly linked to this visit. Staff confirm the final
        bill independently.
      </p>
      {error ? (
        <p role="alert" className="text-xs text-red-800">
          {error}
        </p>
      ) : initial ? (
        <LiveOrders key={session.id} initial={initial} />
      ) : (
        <p role="status" className="text-sm text-muted">
          Loading recorded orders…
        </p>
      )}
    </section>
  );
}
