"use client";
import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import {
  BellRing,
  Check,
  ReceiptText,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import { useCart } from "@/features/cart/components/cart-provider";
import { useRealtimeSnapshot } from "@/features/realtime/use-realtime-snapshot";
import { customerPath } from "@/lib/routes";
import { formatMoney } from "@/lib/format";
import { guestTableAction, requestBillAction } from "../actions";
import type { GuestBillSnapshot } from "../types";
import { SharedBillItems } from "./shared-bill-items";
import { ActionButton } from "@/components/action-button";
import { NextStep } from "@/components/next-step";
function Intro({
  closed = false,
  waiting = false,
  demo = false,
  invalid = false,
}: {
  closed?: boolean;
  waiting?: boolean;
  demo?: boolean;
  invalid?: boolean;
}) {
  return (
    <div className="rounded-3xl border border-line bg-white px-6 py-10 text-center">
      <ReceiptText
        className="mx-auto text-accent"
        size={30}
        aria-hidden="true"
      />
      <h2 className="mt-5 font-display text-3xl">
        {closed
          ? "Thank you for joining us."
          : waiting
            ? "Your table bill will appear here"
            : invalid
              ? "Scan your current table QR."
              : "Your table’s orders will appear here"}
      </h2>
      <p className="mx-auto mt-4 max-w-md text-sm leading-7 text-muted">
        {closed
          ? "Staff have closed this dining session. Customer access to this visit’s orders and bill has ended. Scan your table QR for a fresh visit."
          : waiting
            ? "Your order has been sent. Once the kitchen confirms it, this page shows the table’s dishes and prices. Your own receipt is already in Orders."
            : demo
              ? "Demo preview. In live mode, kitchen confirmation authorizes this visit’s shared bill. No real orders or bill requests are created here."
              : invalid
                ? "This code cannot establish a table context. Please scan the current code or ask restaurant staff."
                : "Place your first order to get started. Once the kitchen confirms it, this page shows the table’s dishes and prices for this visit."}
      </p>
    </div>
  );
}
function LiveBill({ initial }: { initial: GuestBillSnapshot }) {
  const { menu, context } = useCart();
  const token =
    context.table.status === "valid" ? context.table.token : undefined;
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState<string>(),
    [accessLost, setAccessLost] = useState(false);
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
      audience: "guest-table",
      restaurantSlug: menu.slug,
      restaurantId: menu.id,
    },
    () => guestTableAction(menu.slug, token),
  );
  const bill = value.bill;
  async function request() {
    if (busy || !bill || bill.access !== "active") return;
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await requestBillAction(menu.slug, bill.id, token);
      if (result.ok) {
        setValue(result.value);
        setNotice("Your bill request has been sent to the restaurant.");
      } else {
        setNotice(result.message);
        if (result.code === "session") setAccessLost(true);
        void refresh();
      }
    } catch {
      setNotice(
        "We couldn’t confirm the response. Refresh to check your request, or retry safely; the same visit cannot create duplicate bill requests.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (denied || accessLost || !privateAvailable)
    return (
      <p
        role="alert"
        className="rounded-3xl border border-line bg-white p-6 text-sm leading-7"
      >
        {denied || accessLost
          ? "This table bill is not available. Customer access ends when staff close the visit."
          : "Checking your current visit… Private bill details stay hidden until your access is verified."}
      </p>
    );
  return (
    <div data-guest-private>
      <div className="mb-5 flex items-center justify-between gap-3 text-xs text-muted">
        <p role="status" data-testid="table-connection">
          {connection === "live"
            ? "Live table updates"
            : connection === "connecting"
              ? "Connecting to your table…"
              : "Reconnecting · last confirmed data"}
        </p>
        {(connection !== "live" || error) && <button
          onClick={() => void refresh()}
          className="flex min-h-11 items-center gap-2 text-accent"
        >
          <RefreshCw size={14} aria-hidden="true" />
          Refresh bill
        </button>}
      </div>
      {error && (
        <p
          role="alert"
          className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-6 text-amber-900"
        >
          {error}
        </p>
      )}
      {!bill || bill.access !== "active" ? (
        <Intro
          waiting={bill?.access === "waiting"}
          closed={bill?.access === "closed" || (!bill && initial.bill !== null)}
        />
      ) : (
        <div
          data-session-id={bill.id}
          className="rounded-3xl border border-line bg-white p-6 sm:p-9"
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-accent">
                {bill.tableLabel} · This visit
              </p>
              <p className="mt-2 text-xs text-muted">
                Everyone’s dishes and prices
              </p>
            </div>
            <ReceiptText
              size={26}
              className="shrink-0 text-accent"
              aria-hidden="true"
            />
          </div>
          <SharedBillItems lines={bill.lines!} currency={bill.currency} />
          <p className="mt-8 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
            Total order value
          </p>
          <p
            data-testid="shared-total"
            className="mt-3 font-display text-5xl tabular-nums text-accent sm:text-6xl"
          >
            {formatMoney(bill.totals!.orderValueMinor, bill.currency)}
          </p>
          <p className="mt-3 text-xs leading-6 text-muted">
            {bill.totals!.orderCount} orders this visit · Cancelled orders
            excluded
          </p>
          <dl className="mt-7 space-y-4 border-y border-line py-6 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt>Confirmed by kitchen</dt>
              <dd
                data-testid="shared-accepted"
                className="shrink-0 tabular-nums"
              >
                {formatMoney(bill.totals!.confirmedMinor, bill.currency)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt>Sent · not yet confirmed ({bill.totals!.pendingCount})</dt>
              <dd data-testid="shared-pending" className="tabular-nums">
                {formatMoney(bill.totals!.pendingMinor, bill.currency)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 text-xs text-muted">
              <dt>Cancelled · excluded</dt>
              <dd data-testid="shared-cancelled" className="tabular-nums">
                {formatMoney(bill.totals!.cancelledMinor, bill.currency)}
              </dd>
            </div>
          </dl>
          <p className="mt-5 text-xs leading-6 text-muted">
            Staff confirm the final bill and handle payment directly.
            These totals show what was ordered, not what has been paid.
          </p>
          {bill.request ? (
            <div
              role="status"
              data-testid="bill-request-status"
              className="mt-6 flex items-start gap-3 rounded-2xl border-2 border-accent/30 bg-accent-soft p-5 text-accent"
            >
              <Check className="mt-0.5 shrink-0" size={19} aria-hidden="true" />
              <div>
                <p className="text-base font-bold">
                  {bill.request.status === "acknowledged"
                    ? "A staff member is bringing your bill."
                    : "Your bill request has been sent."}
                </p>
                <p className="mt-2 text-xs leading-6">
                  {bill.request.status === "acknowledged"
                    ? "A member of the team will assist you directly."
                    : "The restaurant team can now see your request. There’s no need to send it again."}
                </p>
              </div>
            </div>
          ) : (<>
            <div className="mt-6"><NextStep title="Ready to finish your visit?">Tap Request the Bill below. Staff will see your request and help you directly.</NextStep></div>
            <ActionButton
              type="button"
              onClick={() => void request()}
              disabled={busy}
              tone="progress"
              className="mt-6 min-h-14 w-full"
            >
              <BellRing size={18} aria-hidden="true" />
              {busy ? "Sending request…" : "Request the Bill"}
            </ActionButton>
          </>)}
          {notice && !bill.request && (
            <p role="status" className="mt-4 text-xs leading-6 text-accent">
              {notice}
            </p>
          )}
          <details className="disclosure mt-6 border-t border-line pt-2 text-xs text-muted">
            <summary>About this table bill</summary>
            <p className="flex items-start gap-2 pb-3 leading-6">
              <ShieldCheck
                className="mt-1 shrink-0"
                size={14}
                aria-hidden="true"
              />
              Approved guests share this visit’s dishes and prices. Guest
              identities, private receipts and previous visits are not shared.
            </p>
          </details>
        </div>
      )}
    </div>
  );
}
export function GuestTableBill({
  initial,
  invalidQR,
}: {
  initial: GuestBillSnapshot | null;
  invalidQR: boolean;
}) {
  const { menu, context } = useCart();
  const token =
    context.table.status === "valid" ? context.table.token : undefined;
  return (
    <div className="motion-enter mx-auto max-w-2xl pb-10">
      <h1 className="mt-5 font-display text-4xl sm:text-5xl">Table bill</h1>
      <p className="mb-7 mt-3 text-sm text-muted">
        {menu.name}
        {context.table.status === "valid" ? ` · ${context.table.label}` : ""}
      </p>
      {initial && !invalidQR ? (
        <LiveBill key={menu.id} initial={initial} />
      ) : (
        <>
          <Intro demo={context.mode === "demo"} invalid={invalidQR} />
          <button
            disabled
            className="mt-5 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border border-line bg-white text-sm text-muted"
          >
            <BellRing size={17} aria-hidden="true" />
            Request the Bill
          </button>
          <p className="mt-3 text-center text-xs text-muted">
            Available once the kitchen confirms your first order for this visit.
          </p>
        </>
      )}
      <Link
        prefetch={false}
        href={customerPath(menu.slug, "orders", token) as Route}
        className="mt-6 inline-flex min-h-12 items-center text-sm font-medium text-accent"
      >
        View my current orders →
      </Link>
    </div>
  );
}
