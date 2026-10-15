"use client";
import { ReceiptText, Clock3, ShieldCheck, ArrowRight } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { customerPath } from "@/lib/routes";
import { useCart } from "@/features/cart/components/cart-provider";
import { formatMoney } from "@/lib/format";
import type { GuestOrderHistory } from "../types";

export function BillSummary({
  history,
  demo = false,
}: {
  history: GuestOrderHistory | null;
  demo?: boolean;
}) {
  const { menu, context } = useCart();
  const token =
    context.table.status === "valid" ? context.table.token : undefined;
  const totals = history?.totals;
  const currency = history?.currency ?? menu.currency;
  return (
    <aside
      aria-labelledby="bill-title"
      className="h-fit rounded-3xl border border-line bg-[#efeee5] p-6 sm:p-7 md:sticky md:top-6"
    >
      <div className="flex items-center gap-2 text-accent">
        <ReceiptText size={18} aria-hidden="true" />
        <h2 id="bill-title" className="text-sm font-medium">
          Your orders this visit
        </h2>
      </div>
      <p className="mt-6 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
        Accepted · this visit
      </p>
      <p
        data-testid="confirmed-total"
        className="mt-2 font-display text-5xl tabular-nums tracking-tight text-accent"
      >
        {formatMoney(totals?.confirmedMinor ?? 0, currency)}
      </p>
      <p className="mt-3 text-xs leading-6 text-muted">
        {totals?.confirmedCount ?? 0} accepted{" "}
        {(totals?.confirmedCount ?? 0) === 1 ? "order" : "orders"}, including
        food being prepared, ready or served.
      </p>
      <dl className="mt-6 space-y-4 border-y border-line py-5 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt>
            Personal order value{" "}
            <span className="block mt-1 text-[11px] text-muted">
              Accepted + pending; excludes cancelled
            </span>
          </dt>
          <dd
            data-testid="order-value"
            className="shrink-0 font-medium tabular-nums"
          >
            {formatMoney(totals?.orderValueMinor ?? 0, currency)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="flex items-center gap-2">
            <Clock3 size={15} className="text-amber-700" aria-hidden="true" />
            Awaiting acceptance{" "}
            <span className="text-xs text-muted">
              ({totals?.pendingCount ?? 0})
            </span>
          </dt>
          <dd
            data-testid="pending-total"
            className="shrink-0 font-medium tabular-nums"
          >
            {formatMoney(totals?.pendingMinor ?? 0, currency)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3 text-xs text-muted">
          <dt>Cancelled · excluded ({totals?.cancelledCount ?? 0})</dt>
          <dd data-testid="cancelled-total" className="tabular-nums">
            {formatMoney(totals?.cancelledMinor ?? 0, currency)}
          </dd>
        </div>
      </dl>
      <p className="mt-5 text-xs leading-6 text-muted">
        These are order values, not a payment balance. Payment is handled
        directly by restaurant staff; this app does not verify payments.
      </p>
      <Link
        href={customerPath(menu.slug, "bill", token) as Route}
        prefetch={false}
        className="mt-6 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border border-accent/20 bg-white/70 px-4 text-sm font-medium text-accent"
      >
        Current table bill <ArrowRight size={17} aria-hidden="true" />
      </Link>
      <p
        id="bill-request-note"
        className="mt-3 text-center text-xs leading-5 text-muted"
      >
        {demo ? "Demo preview. " : ""}Only your own orders from this active
        visit. Open Table bill for everyone’s dishes, shared total and staff
        assistance.
      </p>
      <p className="mt-6 flex items-start gap-2 border-t border-line pt-5 text-[11px] leading-5 text-muted">
        <ShieldCheck
          size={14}
          className="mt-0.5 shrink-0 text-accent"
          aria-hidden="true"
        />
        Order access at {menu.name} ends when staff close this visit. The shared
        Table bill shows dishes for approved participants in the current visit.
      </p>
    </aside>
  );
}
