"use client";
import { Check, CircleX, WifiOff } from "lucide-react";
import { progressLabels } from "../progress";
import type { OrderProgress } from "../progress";
export function OrderTracking({
  tracking,
}: {
  tracking: {
    value: OrderProgress;
    connection: string;
    error?: string;
    denied: boolean;
    refresh: () => Promise<void>;
  };
}) {
  const status = tracking.value.status;
  const Icon = status === "cancelled" ? CircleX : Check;
  return (
    <>
      <span
        className={`mx-auto flex size-14 items-center justify-center rounded-full ${status === "cancelled" ? "bg-red-50 text-red-800" : "bg-accent-soft text-accent"}`}
      >
        <Icon size={30} strokeWidth={1.6} aria-hidden="true" />
      </span>
      <h1 className="mt-4 font-display text-3xl sm:text-5xl">
        {status === "cancelled"
          ? "Order cancelled."
          : status === "served"
            ? "Order served."
            : "Order sent."}
      </h1>
      <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted">
        {status === "cancelled"
          ? "The restaurant couldn’t fulfil this order."
          : status === "served"
            ? "This order has been served. You can keep browsing or order something else."
            : "The restaurant has your order. You don’t need to confirm anything else."}
      </p>
      <div className="mx-auto max-w-lg" aria-live="polite" aria-atomic="true">
        <span data-testid="order-status" className="sr-only">
          <Icon size={17} aria-hidden="true" />
          {progressLabels[status]}
        </span>
        {status === "cancelled" ? (
          <p className="mt-4 text-sm leading-6 text-muted">
            {tracking.value.cancelReason ??
              "Please speak to the restaurant team for help."}
          </p>
        ) : null}
        {tracking.connection !== "live" && (
          <p className="mt-4 flex items-center justify-center gap-2 text-xs text-muted">
            <WifiOff size={12} aria-hidden="true" />
            Reconnecting to the restaurant…
          </p>
        )}
        {tracking.error && (
          <p role="status" className="mt-3 text-xs leading-6 text-muted">
            {tracking.error}{" "}
            {!tracking.denied && (
              <button
                type="button"
                onClick={() => void tracking.refresh()}
                className="min-h-11 underline"
              >
                Check now
              </button>
            )}
          </p>
        )}
      </div>
    </>
  );
}
