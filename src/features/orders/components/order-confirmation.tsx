"use client";
import Link from "next/link";
import { useRealtimeSnapshot } from "@/features/realtime/use-realtime-snapshot";
import { guestProgressAction } from "../progress-actions";
import type { Route } from "next";
import { MapPin, ShieldCheck } from "lucide-react";
import type { ConfirmedOrder } from "../types";
import { OrderTracking } from "./order-tracking";
import { customerPath } from "@/lib/routes";
import { cartLineKey } from "@/features/cart/model";
import { OrderSummary } from "./order-summary";
import { ConfirmationCleanup } from "./confirmation-cleanup";
import { ConfirmationNextSteps } from "./confirmation-next-steps";

export function OrderConfirmation({
  order,
  tableToken,
  menuAvailable = true,
  menuLoadFailed = false,
}: {
  order: ConfirmedOrder;
  tableToken?: string;
  menuAvailable?: boolean;
  menuLoadFailed?: boolean;
}) {
  const tracking = useRealtimeSnapshot(
    {
      id: order.id,
      restaurantId: order.restaurant.id,
      status: order.status,
      updatedAt: order.createdAt,
      cancelReason: null as string | null,
    },
    {
      audience: "guest",
      restaurantSlug: order.restaurant.slug,
      orderId: order.id,
    },
    async () => {
      const result = await guestProgressAction(order.restaurant.slug, order.id);
      return result.ok ? { ok: true, value: result.progress } : result;
    },
  );
  if (tracking.denied || !tracking.privateAvailable)
    return (
      <div
        role="status"
        className="mx-auto max-w-lg rounded-3xl border border-line bg-white p-8"
      >
        <h1 className="font-display text-3xl">
          {tracking.denied
            ? "This order is no longer available."
            : "Checking your current visit…"}
        </h1>
        <p className="mt-4 text-sm leading-7 text-muted">
          {tracking.denied
            ? "Customer access ends when the restaurant closes the dining session. Historical records are available only to restaurant staff."
            : "Private order details stay hidden until the restaurant verifies that this visit is still active."}
        </p>
        <Link
          prefetch={false}
          className="mt-5 inline-flex min-h-12 items-center font-medium text-accent"
          href={
            customerPath(order.restaurant.slug, "menu", tableToken) as Route
          }
        >
          Open menu →
        </Link>
      </div>
    );
  return (
    <div data-guest-private className="motion-enter mx-auto max-w-4xl pb-10">
      <ConfirmationCleanup orderId={order.id} />
      <div className="rounded-3xl border border-line bg-white/60 px-6 py-7 text-center sm:px-10 sm:py-14">
        <OrderTracking tracking={tracking} />
        <ConfirmationNextSteps
          slug={order.restaurant.slug}
          tableToken={tableToken}
          cancelled={tracking.value.status === "cancelled"}
          menuAvailable={menuAvailable}
        />
      </div>
      <div className="mt-7 grid items-start gap-6 md:grid-cols-[1.5fr_1fr]">
        <section aria-label="Confirmed order items">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 px-1">
            <h2 className="font-display text-2xl">Your selection.</h2>
            <p className="text-xs text-muted">Confirmed prices</p>
          </div>
          <OrderSummary
            lines={order.items.map((item) => ({
              key: cartLineKey({
                productId: item.productId,
                optionIds: item.options.map((option) => option.id),
                notes: item.notes,
              }),
              name: item.productName,
              quantity: item.quantity,
              unitPriceMinor: item.unitPriceMinor,
              totalMinor: item.lineTotalMinor,
              notes: item.notes,
              options: item.options.map((option) => ({
                ...option,
                group: option.groupName,
              })),
            }))}
            currency={order.currency}
            totalMinor={order.totalMinor}
          />
        </section>
        <aside
          className="rounded-3xl border border-line bg-[#efeee5] p-6 sm:p-7"
          aria-labelledby="confirmed-details-title"
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
            Your order reference
          </p>
          <h2
            id="confirmed-details-title"
            className="mt-3 break-all font-display text-3xl"
          >
            #{order.reference}
          </h2>
          <p className="mt-5 text-sm font-medium">{order.restaurant.name}</p>
          <p className="mt-2 flex items-center gap-2 text-sm text-accent">
            <MapPin size={15} aria-hidden="true" />
            {order.table.label}
          </p>
          <p className="mt-6 border-t border-line pt-5 text-xs leading-6 text-muted">
            Payment will be handled directly by restaurant staff.
          </p>
          {!menuAvailable && (
            <p
              role="status"
              className="mt-6 rounded-xl border border-line bg-white/60 p-4 text-xs leading-6 text-muted"
            >
              {menuLoadFailed
                ? "The menu could not be loaded right now. Your confirmed order remains available here."
                : "The restaurant menu is currently unavailable. Your confirmed order is safely recorded. Please ask our team for help."}
            </p>
          )}
          <p className="mt-5 flex items-start gap-2 text-[11px] leading-5 text-muted">
            <ShieldCheck
              size={14}
              className="mt-0.5 shrink-0 text-accent"
              aria-hidden="true"
            />
            Order access lasts only for this active visit. Staff closing the
            session ends customer access, even in this same browser.
          </p>
        </aside>
      </div>
    </div>
  );
}
