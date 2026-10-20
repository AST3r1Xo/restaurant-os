import Link from "next/link";
import type { Route } from "next";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  ClipboardList,
  Info,
  Utensils,
} from "lucide-react";
import { formatMoney } from "@/lib/format";
import { OrderSummary } from "@/features/orders/components/order-summary";
import { reportHref, shiftReportDay } from "../model";
import type { DailyReport } from "../types";
import { RefreshReport } from "./refresh-report";

const labels = {
  pending: "Pending",
  accepted: "Confirmed",
  preparing: "In preparation",
  ready: "Ready for service",
  served: "Served",
  cancelled: "Cancelled",
};
const colors = {
  pending: "bg-attention-soft text-attention",
  accepted: "bg-progress-soft text-progress",
  preparing: "bg-progress-soft text-progress",
  ready: "bg-progress-soft text-progress",
  served: "bg-accent-soft text-accent",
  cancelled: "bg-danger-soft text-danger",
};

export function DailyDashboard({
  report,
  demo = false,
  paginated = false,
}: {
  report: DailyReport;
  demo?: boolean;
  paginated?: boolean;
}) {
  const { totals, currency, products } = report;
  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "full",
    timeZone: "UTC",
  }).format(new Date(`${report.day}T12:00:00Z`));
  const best = [...products].sort(
    (a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name),
  );
  const least = [...products]
    .sort((a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name))
    .slice(0, 5);
  const peak = best[0]?.quantity ?? 1;
  const firstHref = reportHref({ day: report.day, currency });
  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.18em] text-accent">
            Restaurant history {demo && "· Sample data"}
          </p>
          <h1 className="mt-3 font-display text-4xl sm:text-5xl">
            Your day, at a glance.
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            Orders, dishes and recorded value. Choose a day to look back.
          </p>
        </div>
        <Link
          href="/admin"
          className="inline-flex min-h-12 items-center gap-2 rounded-full border border-line bg-white px-5 text-sm font-medium text-accent"
        >
          <ClipboardList size={17} aria-hidden="true" /> Back to kitchen
        </Link>
      </div>

      <section
        aria-label="Choose reporting day"
        className="flex flex-wrap items-center justify-between gap-5 rounded-2xl border border-line bg-white p-4 sm:p-5"
      >
        <div className="flex items-center gap-3">
          <CalendarDays size={20} className="text-accent" aria-hidden="true" />
          <div>
            <h2 className="font-medium">{dateLabel}</h2>
            <p className="mt-1 text-xs text-muted">
              Restaurant time · {report.timezone.replaceAll("_", " ")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {report.day > "2000-01-01" && (
            <Link
              href={
                reportHref({ day: shiftReportDay(report.day, -1) }) as Route
              }
              aria-label="Previous day"
              className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-xl border border-line text-accent"
            >
              <ArrowLeft size={18} aria-hidden="true" />
            </Link>
          )}
          <form
            action="/admin/history"
            method="get"
            className="flex flex-wrap items-end gap-2"
          >
            <label className="sr-only" htmlFor="report-date">
              Day
            </label>
            <input
              id="report-date"
              name="date"
              type="date"
              required
              min="2000-01-01"
              max={report.today}
              defaultValue={report.day}
              className="min-h-12 min-w-0 rounded-xl border border-line bg-background px-3 text-sm"
            />
            <button
              type="submit"
              className="min-h-12 rounded-xl bg-accent px-4 text-sm font-medium text-white"
            >
              View day
            </button>
          </form>
          {report.day < report.today && (
            <Link
              href={reportHref({ day: shiftReportDay(report.day, 1) }) as Route}
              aria-label="Next day"
              className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-xl border border-line text-accent"
            >
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          )}
          {report.day !== report.today && (
            <Link
              href="/admin/history"
              className="inline-flex min-h-12 items-center px-3 text-sm font-medium text-accent"
            >
              Today
            </Link>
          )}
        </div>
      </section>

      {report.currencies.length > 1 && (
        <nav
          aria-label="Order currency"
          className="flex flex-wrap items-center gap-2 text-sm"
        >
          <span className="mr-2 text-muted">Show amounts in</span>
          {report.currencies.map((c) => (
            <Link
              key={c}
              href={reportHref({ day: report.day, currency: c }) as Route}
              aria-current={c === currency ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-full px-4 ${c === currency ? "bg-accent text-white" : "border border-line bg-white text-accent"}`}
            >
              {c}
            </Link>
          ))}
          <p className="w-full text-xs text-muted">
            Each currency is reported separately; amounts are never combined or
            converted.
          </p>
        </nav>
      )}

      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl bg-accent p-6 text-white">
          <dt className="text-xs font-medium uppercase tracking-wider text-white/80">
            Confirmed order value
          </dt>
          <dd className="mt-4 font-display text-4xl tabular-nums">
            {formatMoney(totals.confirmedMinor, currency)}
          </dd>
          <dd className="mt-3 text-xs leading-5 text-white/80">
            {totals.confirmedCount} confirmed orders · cancellations excluded
          </dd>
        </div>
        <div className="rounded-2xl border border-line bg-white p-6">
          <dt className="text-sm text-muted">Orders received</dt>
          <dd className="mt-3 font-display text-4xl tabular-nums">
            {totals.orderCount}
          </dd>
          <dd className="mt-3 text-xs text-muted">
            {totals.servedCount} served · {totals.cancelledCount} cancelled
          </dd>
        </div>
        <div className="rounded-2xl border border-line bg-white p-6">
          <dt className="flex items-center gap-2 text-sm text-muted">
            <Utensils size={16} aria-hidden="true" /> Dishes ordered
          </dt>
          <dd className="mt-3 font-display text-4xl tabular-nums">
            {totals.dishCount}
          </dd>
          <dd className="mt-3 text-xs text-muted">Units in confirmed orders</dd>
        </div>
        <div className="rounded-2xl border border-line bg-white p-6">
          <dt className="text-sm text-muted">Average confirmed order</dt>
          <dd className="mt-3 font-display text-4xl tabular-nums">
            {formatMoney(
              totals.confirmedCount
                ? Math.round(totals.confirmedMinor / totals.confirmedCount)
                : 0,
              currency,
            )}
          </dd>
          <dd className="mt-3 text-xs text-muted">
            Recorded order value ÷ confirmed orders
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-xl bg-white/70 px-4 py-3 text-xs leading-6">
        <p className="text-attention">
          <strong>{totals.pendingCount} pending</strong> ·{" "}
          {formatMoney(totals.pendingMinor, currency)} awaiting staff
          confirmation
        </p>
        <p className="text-danger">
          <strong>{totals.cancelledCount} cancelled</strong> ·{" "}
          {formatMoney(totals.cancelledMinor, currency)} excluded
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
        <section
          className="rounded-3xl border border-line bg-white p-5 sm:p-7"
          aria-labelledby="dish-ranking-title"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="dish-ranking-title" className="font-display text-2xl">
                Most ordered dishes
              </h2>
              <p className="mt-2 text-xs leading-6 text-muted">
                Confirmed quantities, including customizations. Pending and
                cancelled orders are excluded.
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-accent-soft px-3 py-2 text-xs text-accent">
              {products.length} dishes
            </span>
          </div>
          {!best.length ? (
            <div className="py-14 text-center">
              <Utensils
                size={28}
                className="mx-auto text-muted"
                aria-hidden="true"
              />
              <p className="mt-4 font-medium">
                No confirmed dishes for this day.
              </p>
              <p className="mt-2 text-sm text-muted">
                The chart appears once restaurant staff confirm an order.
              </p>
            </div>
          ) : (
            <>
              <figure className="mt-7">
                <figcaption className="sr-only">
                  Top {Math.min(best.length, 8)} dishes by confirmed units on{" "}
                  {dateLabel}. Source: stored order snapshots.
                </figcaption>
                <ol
                  className="space-y-5"
                  aria-label="Dishes ranked by confirmed quantity"
                >
                  {best.slice(0, 8).map((p, i) => (
                    <li key={p.productId}>
                      <div className="mb-2 flex items-start justify-between gap-3 text-sm">
                        <span className="min-w-0 break-words">
                          <span className="mr-2 text-xs text-muted">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          {p.name}
                        </span>
                        <strong className="shrink-0 tabular-nums text-accent">
                          {p.quantity}{" "}
                          <span className="font-normal text-muted">units</span>
                        </strong>
                      </div>
                      <div
                        aria-hidden="true"
                        className="h-2 overflow-hidden rounded-full bg-accent-soft"
                      >
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{
                            width: `${Math.max(1, (p.quantity / peak) * 100)}%`,
                          }}
                        />
                      </div>
                      <p className="mt-1.5 text-right text-[11px] text-muted">
                        {formatMoney(p.totalMinor, currency)} recorded ·{" "}
                        {p.orderCount} orders
                      </p>
                    </li>
                  ))}
                </ol>
              </figure>
              {best.length > 8 && (
                <details className="mt-6 border-t border-line pt-3">
                  <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-2 text-sm font-medium text-accent">
                    All {best.length} dishes
                    <ChevronDown size={17} aria-hidden="true" />
                  </summary>
                  <ol start={9} className="space-y-3 pb-3">
                    {best.slice(8).map((p) => (
                      <li
                        key={p.productId}
                        className="flex justify-between gap-4 text-sm"
                      >
                        <span>{p.name}</span>
                        <span className="shrink-0 tabular-nums">
                          {p.quantity} units ·{" "}
                          {formatMoney(p.totalMinor, currency)}
                        </span>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </>
          )}
        </section>
        <section
          className="rounded-3xl border border-line bg-white p-5 sm:p-7"
          aria-labelledby="least-title"
        >
          <h2 id="least-title" className="font-display text-2xl">
            Less ordered
          </h2>
          <p className="mt-2 text-xs leading-6 text-muted">
            Lowest quantities among dishes with confirmed orders that day.
          </p>
          {least.length ? (
            <ol className="mt-5 divide-y divide-line">
              {least.map((p) => (
                <li
                  key={p.productId}
                  className="flex items-start justify-between gap-4 py-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{p.name}</p>
                    <p className="mt-1 text-xs text-muted">
                      {formatMoney(p.totalMinor, currency)} recorded
                    </p>
                  </div>
                  <span className="shrink-0 rounded-lg bg-background px-3 py-2 text-sm tabular-nums">
                    {p.quantity}×
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="py-10 text-sm text-muted">
              No confirmed orders to compare.
            </p>
          )}
          <p className="mt-5 border-t border-line pt-4 text-xs leading-6 text-muted">
            Dishes with no orders are not ranked. Historical menu availability
            is not recorded, so this view does not assume they were on sale that
            day.
          </p>
        </section>
      </div>

      <section aria-labelledby="daily-orders-title">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="daily-orders-title" className="font-display text-3xl">
              Orders from this day
            </h2>
            <p className="mt-2 text-sm text-muted">
              Open an order for dishes, customizations and confirmed prices.
            </p>
          </div>
          <span className="text-xs text-muted">
            {report.orders.length} on this page · {totals.orderCount} total
          </span>
        </div>
        {!report.orders.length ? (
          <div className="rounded-2xl border border-dashed border-line bg-white/50 px-6 py-12 text-center">
            <ClipboardList
              size={28}
              className="mx-auto text-muted"
              aria-hidden="true"
            />
            <p className="mt-4 font-medium">No orders recorded for this day.</p>
            <p className="mt-2 text-sm text-muted">
              Choose another date to explore your restaurant history.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {report.orders.map((o) => (
              <details
                key={o.id}
                className="group rounded-2xl border border-line bg-white"
              >
                <summary className="flex min-h-20 cursor-pointer flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
                  <span
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold ${colors[o.status]}`}
                  >
                    {o.status === "served" && (
                      <Check
                        size={12}
                        className="mr-1 inline"
                        aria-hidden="true"
                      />
                    )}
                    {labels[o.status]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">
                      {o.tableLabel || "Table not recorded"}{" "}
                      <span className="ml-2 font-normal text-muted">
                        #{o.reference}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      <time dateTime={o.createdAt}>
                        {new Intl.DateTimeFormat("en-GB", {
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: report.timezone,
                        }).format(new Date(o.createdAt))}
                      </time>{" "}
                      · {o.items.reduce((n, i) => n + i.quantity, 0)} items
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">
                    {formatMoney(o.totalMinor, currency)}
                  </span>
                  <ChevronDown
                    size={18}
                    className="text-muted transition-transform group-open:rotate-180"
                    aria-hidden="true"
                  />
                </summary>
                <div className="border-t border-line p-3 sm:p-5">
                  <OrderSummary
                    lines={o.items.map((i) => ({
                      key: i.id,
                      name: i.name,
                      quantity: i.quantity,
                      unitPriceMinor: i.unitPriceMinor,
                      totalMinor: i.lineTotalMinor,
                      notes: i.notes,
                      options: i.options.map((option) => ({
                        ...option,
                        group: option.groupName,
                      })),
                    }))}
                    currency={currency}
                    totalMinor={o.totalMinor}
                  />
                  {o.notes && (
                    <p className="mt-3 whitespace-pre-wrap text-sm text-muted">
                      Instructions: {o.notes}
                    </p>
                  )}
                  {o.cancelReason && (
                    <p className="mt-3 rounded-xl bg-danger-soft p-3 text-sm text-danger">
                      Cancelled: {o.cancelReason}
                    </p>
                  )}
                </div>
              </details>
            ))}
          </div>
        )}
        <nav
          aria-label="Daily order pages"
          className="mt-5 flex flex-wrap items-center gap-3"
        >
          {report.nextCursor && (
            <Link
              href={
                reportHref({
                  day: report.day,
                  currency,
                  before: report.nextCursor,
                }) as Route
              }
              className="inline-flex min-h-12 items-center gap-2 rounded-full bg-accent px-5 text-sm font-medium text-white"
            >
              Older orders from this day{" "}
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
          )}
          {paginated && (
            <Link
              href={firstHref as Route}
              className="inline-flex min-h-12 items-center px-4 text-sm font-medium text-accent"
            >
              Back to latest orders
            </Link>
          )}
          {!demo && <RefreshReport />}
        </nav>
      </section>

      <p className="flex items-start gap-2 rounded-xl bg-accent-soft px-4 py-3 text-xs leading-6 text-accent">
        <Info size={16} className="mt-1 shrink-0" aria-hidden="true" />
        <span>
          These are recorded order amounts, not verified takings or a tax
          invoice. Payment is handled and confirmed by restaurant staff outside
          Restaurant OS. Orders are assigned to the day they were placed;
          statuses reflect the latest restaurant record. Last loaded{" "}
          {new Intl.DateTimeFormat("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: report.timezone,
          }).format(new Date(report.fetchedAt))}
          .
        </span>
      </p>
    </div>
  );
}
