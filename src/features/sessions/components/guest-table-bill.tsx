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
            ? "The kitchen will welcome you shortly."
            : invalid
              ? "Scan your current table QR."
              : "A shared table. A fresh visit."}
      </h2>
      <p className="mx-auto mt-4 max-w-md text-sm leading-7 text-muted">
        {closed
          ? "Staff have closed this dining session. Customer access to this visit’s orders and bill has ended. Scan your table QR for a fresh visit."
          : waiting
            ? "Your shared table bill becomes available after staff accept your first order for this visit. You can already follow your own order in Current orders."
            : demo
              ? "Demo preview. In live mode, staff acceptance authorizes the shared itemized bill for this dining session. No real orders or bill requests are created here."
              : invalid
                ? "This code cannot establish a table context. Please scan the current code or ask restaurant staff."
                : "Place an order and wait for the restaurant to accept it. Then you can see everyone’s dishes and prices for this visit. Scanning a QR alone does not grant shared bill access."}
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
        <button
          onClick={() => void refresh()}
          className="flex min-h-11 items-center gap-2 text-accent"
        >
          <RefreshCw size={14} aria-hidden="true" />
          Refresh bill
        </button>
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
                {bill.tableLabel} · Current dining session
              </p>
              <p className="mt-2 text-xs text-muted">
                This visit only · Earlier visits are excluded
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
            Recorded order value
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
              <dt>Accepted, preparing, ready &amp; served</dt>
              <dd
                data-testid="shared-accepted"
                className="shrink-0 tabular-nums"
              >
                {formatMoney(bill.totals!.confirmedMinor, bill.currency)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt>Pending acceptance ({bill.totals!.pendingCount})</dt>
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
            Staff confirm the final bill. These are recorded order values, not a
            verified outstanding balance. Payment is handled directly by
            restaurant employees outside this app.
          </p>
          {bill.request ? (
            <div
              role="status"
              data-testid="bill-request-status"
              className="mt-6 flex items-start gap-3 rounded-2xl bg-accent-soft p-5 text-accent"
            >
              <Check className="mt-0.5 shrink-0" size={19} aria-hidden="true" />
              <div>
                <p className="text-sm font-medium">
                  {bill.request.status === "acknowledged"
                    ? "Staff have acknowledged your bill request."
                    : "Your bill request has been sent."}
                </p>
                <p className="mt-2 text-xs leading-6">
                  {bill.request.status === "acknowledged"
                    ? "A member of the team will assist you directly."
                    : "The restaurant team can now see your request. There’s no need to send it again."}
                </p>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void request()}
              disabled={busy}
              className="mt-6 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-accent px-6 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-60"
            >
              <BellRing size={18} aria-hidden="true" />
              {busy ? "Sending request…" : "Request the Bill"}
            </button>
          )}
          {notice && !bill.request && (
            <p role="status" className="mt-4 text-xs leading-6 text-accent">
              {notice}
            </p>
          )}
          <p className="mt-7 flex items-start gap-2 border-t border-line pt-5 text-[11px] leading-6 text-muted">
            <ShieldCheck
              className="mt-1 shrink-0"
              size={14}
              aria-hidden="true"
            />
            Approved guests share this visit’s dishes and prices. Guest
            identities, private receipts and previous visits are not shared.
          </p>
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
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
        Together at the table
      </p>
      <h1 className="mt-3 font-display text-4xl sm:text-5xl">Table bill</h1>
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
            Available to authorized guests in an active dining session.
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
