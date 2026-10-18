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
        className={`mx-auto flex size-16 items-center justify-center rounded-full ${status === "cancelled" ? "bg-red-50 text-red-800" : "bg-accent-soft text-accent"}`}
      >
        <Icon size={30} strokeWidth={1.6} aria-hidden="true" />
      </span>
      <p className="mt-6 text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
        Your order
      </p>
      <h1 className="mt-3 font-display text-4xl sm:text-5xl">
        {status === "cancelled" ? "Order cancelled." : "Order confirmed."}
      </h1>
      <p className="mx-auto mt-4 max-w-md text-sm leading-7 text-muted">
        {status === "cancelled"
          ? "The restaurant couldn’t fulfil this order."
          : "Your order has been sent to the restaurant. Our team coordinates when dishes are brought to your table."}
      </p>
      <div
        className="mx-auto mt-6 max-w-lg"
        aria-live="polite"
        aria-atomic="true"
      >
        <span
          data-testid="order-status"
          className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium ${status === "cancelled" ? "border-red-200 bg-red-50 text-red-800" : "border-accent/15 bg-accent-soft text-accent"}`}
        >
          <Icon size={17} aria-hidden="true" />
          {progressLabels[status]}
        </span>
        {status === "cancelled" ? (
          <p className="mt-4 text-sm leading-6 text-muted">
            {tracking.value.cancelReason ??
              "Please speak to the restaurant team for help."}
          </p>
        ) : null}
        {tracking.connection !== "live" && <p className="mt-4 flex items-center justify-center gap-2 text-xs text-muted">
            <WifiOff size={12} aria-hidden="true" />
            Reconnecting to the restaurant…
        </p>}
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
