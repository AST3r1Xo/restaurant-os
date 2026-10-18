import Link from "next/link";
import type { Route } from "next";
import { ChevronDown, ArrowRight } from "lucide-react";
import { orderPath } from "@/lib/routes";
import { formatMoney } from "@/lib/format";
import { progressLabels, customerOrderLabel } from "../../progress";
import { OrderSummary } from "../../components/order-summary";
import type { HistoryOrder } from "../types";

export function OrderCard({
  order,
  token,
}: {
  order: HistoryOrder;
  token?: string;
}) {
  const cancelled = order.status === "cancelled";
  return (
    <details
      data-order-id={order.id}
      className="group rounded-3xl border border-line bg-white transition-colors open:border-accent/30"
    >
      <summary className="flex min-h-28 list-none items-start gap-3 rounded-3xl p-5 sm:p-6 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-sm font-semibold">
              Order #{order.reference}
            </span>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${cancelled ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent"}`}
            >
              {customerOrderLabel(order.status)}
            </span>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted">
            {order.table.label} · This visit
          </p>
          <p className="mt-3 line-clamp-2 text-xs leading-6 text-muted">
            {order.items
              .map((item) => `${item.quantity}× ${item.productName}`)
              .join(" · ")}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-3">
          <span
            className={`font-display text-xl tabular-nums ${cancelled ? "text-muted" : "text-accent"}`}
          >
            {formatMoney(order.totalMinor, order.currency)}
          </span>
          <ChevronDown
            size={18}
            className="text-muted transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
          <span className="sr-only">Expand order details</span>
        </div>
      </summary>
      <div className="border-t border-line px-4 pb-5 pt-4 sm:px-6">
        <p
          className={`mb-4 text-xs leading-6 ${cancelled ? "text-red-800" : "text-accent"}`}
        >
          {progressLabels[order.status]}
          {order.cancelReason ? `. ${order.cancelReason}` : ""}
          {cancelled
            ? " This order is excluded from your accepted order value."
            : ""}
        </p>
        <OrderSummary
          lines={order.items.map((item, index) => ({
            key: `${order.id}:${index}`,
            name: item.productName,
            quantity: item.quantity,
            unitPriceMinor: item.unitPriceMinor,
            totalMinor: item.lineTotalMinor,
            options: item.options.map((option) => ({
              ...option,
              group: option.groupName,
            })),
          }))}
          currency={order.currency}
          totalMinor={order.totalMinor}
        />
        <Link
          href={orderPath(order.restaurant.slug, order.id, token) as Route}
          prefetch={false}
          className="mt-3 inline-flex min-h-11 items-center gap-2 px-1 text-xs font-medium text-accent"
        >
          Open order confirmation
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </details>
  );
}
