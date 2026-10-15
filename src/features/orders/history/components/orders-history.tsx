"use client";
import Link from "next/link";
import type { Route } from "next";
import { useRef, useState } from "react";
import { ArrowRight, ReceiptText, RefreshCw } from "lucide-react";
import { useCart } from "@/features/cart/components/cart-provider";
import { useRealtimeSnapshot } from "@/features/realtime/use-realtime-snapshot";
import { customerPath } from "@/lib/routes";
import { guestHistoryAction } from "../actions";
import { mergeHistoryPages } from "../repository";
import type { GuestOrderHistory } from "../types";
import { BillSummary } from "./bill-summary";
import { OrderCard } from "./history-order-card";
import { SavedOrderRequest } from "./saved-order-request";

function HistoryHeader({ count }: { count?: number }) {
  const { menu, context } = useCart();
  return (
    <div className="mb-7">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
        Here for this visit
      </p>
      <h1 className="mt-3 font-display text-3xl sm:text-5xl">Current orders</h1>
      <p className="mt-3 text-sm leading-6 text-muted">
        {menu.name}
        {context.table.status === "valid" ? ` · ${context.table.label}` : ""}
        {count !== undefined
          ? ` · ${count} ${count === 1 ? "order" : "orders"}`
          : ""}
      </p>
      <p className="mt-3 max-w-lg text-xs leading-6 text-muted">
        Your orders for this active visit only. Access ends when staff close the
        table session. Open Table bill for everyone’s dishes and prices.
      </p>
    </div>
  );
}

function EmptyHistory({ demo = false }: { demo?: boolean }) {
  const { menu, context } = useCart();
  const token =
    context.table.status === "valid" ? context.table.token : undefined;
  return (
    <div className="rounded-3xl border border-line bg-white/60 px-6 py-12 text-center sm:py-16">
      <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent">
        <ReceiptText size={24} strokeWidth={1.5} aria-hidden="true" />
      </span>
      <h2 className="mt-5 font-display text-3xl">
        A delicious story starts here.
      </h2>
      <p className="mx-auto mt-4 max-w-md text-sm leading-7 text-muted">
        {demo
          ? "This is a demo preview. Browse, customize and review your bag; real orders require live mode."
          : "No orders for this active visit yet. Orders from previous visits are not available to customers."}
      </p>
      <Link
        href={customerPath(menu.slug, "menu", token) as Route}
        prefetch={false}
        className="mt-7 inline-flex min-h-12 items-center gap-2 rounded-full bg-accent px-6 text-sm font-medium text-white"
      >
        Explore the menu
        <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </div>
  );
}

function LiveHistory({ initial }: { initial: GuestOrderHistory }) {
  const { context } = useCart();
  const pageCount = useRef(1);
  const paging = useRef(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState<string>();
  const [accessLost, setAccessLost] = useState(false);
  const scope = {
    scope: initial.scope,
    tableToken:
      context.table.status === "valid" ? context.table.token : undefined,
  };
  const load = async () => {
    const first = await guestHistoryAction(
      initial.restaurant.slug,
      null,
      scope,
    );
    if (!first.ok) return first;
    const pages = [first.value];
    while (pages.length < pageCount.current && pages.at(-1)!.nextCursor) {
      const next = await guestHistoryAction(
        initial.restaurant.slug,
        pages.at(-1)!.nextCursor,
        scope,
      );
      if (!next.ok) return next;
      pages.push(next.value);
    }
    return { ok: true as const, value: mergeHistoryPages(pages) };
  };
  const {
    value,
    connection,
    error,
    denied,
    privateAvailable,
    refresh,
    setValue,
  } = useRealtimeSnapshot(
    initial,
    {
      audience: "guest-history",
      restaurantSlug: initial.restaurant.slug,
      restaurantId: initial.restaurant.id,
    },
    load,
  );
  const more = async () => {
    if (paging.current || !value.nextCursor) return;
    paging.current = true;
    setLoadingMore(true);
    setPageError(undefined);
    try {
      const result = await guestHistoryAction(
        initial.restaurant.slug,
        value.nextCursor,
        scope,
      );
      if (result.ok) {
        pageCount.current++;
        setValue(mergeHistoryPages([value, result.value]));
        // Reconcile the complete loaded prefix after concurrent inserts/updates.
        void refresh();
      } else {
        setPageError(result.message);
        if (result.code === "session") setAccessLost(true);
      }
    } catch {
      setPageError(
        "More current-visit orders could not be loaded. Please reconnect and retry.",
      );
    } finally {
      paging.current = false;
      setLoadingMore(false);
    }
  };
  if (denied || accessLost || !privateAvailable)
    return (
      <div role="alert" className="rounded-3xl border border-line bg-white p-8">
        <h1 className="font-display text-3xl">
          {denied || accessLost
            ? "Current orders unavailable."
            : "Checking your current visit…"}
        </h1>
        <p className="mt-4 text-sm leading-7 text-muted">
          {pageError ?? error}
        </p>
        <p className="mt-3 text-xs text-muted">
          Private details are shown only after the restaurant verifies an active
          visit. Customer access ends when staff close it.
        </p>
      </div>
    );
  const token =
    context.table.status === "valid" ? context.table.token : undefined;
  return (
    <div data-guest-private>
      <HistoryHeader count={value.totals.orderCount} />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
        <p role="status" className="flex items-center gap-2">
          <span
            className={`size-1.5 rounded-full ${connection === "live" ? "bg-accent" : "bg-amber-600"}`}
            aria-hidden="true"
          />
          {connection === "live"
            ? "Live order updates"
            : connection === "connecting"
              ? "Connecting to the restaurant…"
              : "Connection interrupted · showing last confirmed data"}
        </p>
        <button
          type="button"
          onClick={() => {
            setPageError(undefined);
            void refresh();
          }}
          className="inline-flex min-h-11 items-center gap-2 px-2 text-accent"
        >
          <RefreshCw size={14} aria-hidden="true" />
          Refresh orders
        </button>
      </div>
      {(error || pageError) && (
        <p
          role="alert"
          className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-6 text-amber-900"
        >
          {pageError ?? error}
        </p>
      )}
      <div className="grid items-start gap-6 md:grid-cols-[1.5fr_1fr]">
        <section aria-label="Your current orders" className="min-w-0 space-y-4">
          {!value.orders.length ? (
            <EmptyHistory />
          ) : (
            value.orders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                timezone={value.timezone}
                token={token}
              />
            ))
          )}
          {value.nextCursor && (
            <button
              type="button"
              onClick={() => void more()}
              disabled={loadingMore}
              className="flex min-h-12 w-full items-center justify-center rounded-2xl border border-line bg-white text-sm font-medium text-accent disabled:opacity-50"
            >
              {loadingMore
                ? "Loading more orders…"
                : "Show more current orders"}
            </button>
          )}
        </section>
        <BillSummary history={value} />
      </div>
    </div>
  );
}

export function OrdersHistory({
  initial,
  menuAvailable,
  menuFailed,
}: {
  initial: GuestOrderHistory | null;
  menuAvailable: boolean;
  menuFailed: boolean;
}) {
  const { context } = useCart();
  return (
    <div className="motion-enter mx-auto max-w-5xl pb-10">
      {!menuAvailable && (
        <p
          role="status"
          className="mb-6 rounded-xl border border-line bg-white p-4 text-xs leading-6 text-muted"
        >
          {menuFailed
            ? "The menu could not be loaded right now."
            : "The restaurant menu is currently unavailable."}{" "}
          Your private orders remain available.
        </p>
      )}
      <SavedOrderRequest />
      {initial ? (
        <LiveHistory
          key={`${initial.restaurant.id}:${initial.scope}`}
          initial={initial}
        />
      ) : (
        <>
          <HistoryHeader />
          <div className="grid items-start gap-6 md:grid-cols-[1.5fr_1fr]">
            <EmptyHistory demo={context.mode === "demo"} />
            <BillSummary history={null} demo={context.mode === "demo"} />
          </div>
        </>
      )}
    </div>
  );
}
