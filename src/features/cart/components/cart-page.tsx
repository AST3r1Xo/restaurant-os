"use client";
import Link from "next/link";
import Image from "next/image";
import type { Route } from "next";
import {
  ArrowLeft,
  ArrowRight,
  ShoppingBag,
  Trash2,
  Utensils,
} from "lucide-react";
import { useState } from "react";
import { useCart } from "./cart-provider";
import { QuantityControl } from "@/components/quantity-control";
import { customerPath, productPath } from "@/lib/routes";
import { formatMoney } from "@/lib/format";
import { EmptyState } from "@/components/empty-state";
function CartImage({ src, name }: { src?: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-accent-soft sm:size-24">
      {src && !failed ? (
        <Image
          src={src}
          alt={name}
          fill
          sizes="96px"
          className="object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-accent/40">
          <Utensils size={22} aria-hidden="true" />
        </div>
      )}
    </div>
  );
}
export function CartPageContent() {
  const {
    lines,
    count,
    subtotalMinor,
    hasInvalidItems,
    ready,
    setQuantity,
    remove,
    menu,
    context,
  } = useCart();
  const [announcement, setAnnouncement] = useState("");
  const token =
    context.table.status === "valid" ? context.table.token : undefined;
  const menuHref = customerPath(menu.slug, "menu", token) as Route;
  if (!ready)
    return (
      <div role="status" className="mx-auto max-w-4xl py-16">
        <p className="text-sm text-muted">Opening your bag…</p>
        <div className="mt-6 h-36 animate-pulse rounded-2xl bg-accent-soft" />
      </div>
    );
  if (!lines.length)
    return (
      <>
        <EmptyState
          icon={ShoppingBag}
          eyebrow="Your bag"
          title="Your bag is empty"
          description="Choose a dish from the menu to get started."
          href={menuHref}
          action="Browse menu"
        />
        <p className="-mt-6 pb-6 text-center text-xs text-muted">
          Your bag is saved on this device. Payment is handled by restaurant
          staff.
        </p>
      </>
    );
  return (
    <div className="motion-enter mx-auto max-w-5xl pb-10">
      <Link
        href={menuHref}
        prefetch={false}
        className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm text-muted hover:text-accent"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        Add more dishes
      </Link>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl sm:text-5xl">Your bag</h1>
          <p className="mt-3 text-sm text-muted">
            {count} {count === 1 ? "dish" : "dishes"} ·{" "}
            {context.table.status === "valid"
              ? context.table.label
              : "Browsing the menu"}
          </p>
        </div>
        <span className="rounded-full border border-line bg-white/50 px-3 py-2 text-[11px] text-muted">
          Saved on this device
        </span>
      </div>
      {hasInvalidItems && (
        <p
          role="status"
          className="mb-5 rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-900"
        >
          Some dishes or options have changed. Review or remove the highlighted
          items. They are excluded from your total.
        </p>
      )}
      <div className="grid items-start gap-8 lg:grid-cols-[1.5fr_1fr]">
        <section aria-label="Dishes in your bag" className="space-y-4">
          {lines.map((line) => (
            <article
              key={line.key}
              className="rounded-2xl border border-line bg-white p-4 sm:p-6"
            >
              <div className="flex gap-4">
                <CartImage
                  key={line.product?.image}
                  src={line.product?.image}
                  name={line.product?.name ?? "Unavailable dish"}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-display text-xl leading-tight sm:text-2xl">
                      {line.product ? (
                        <Link
                          href={
                            productPath(
                              menu.slug,
                              line.productId,
                              token,
                            ) as Route
                          }
                          prefetch={false}
                          className="hover:text-accent"
                        >
                          {line.product.name}
                        </Link>
                      ) : (
                        "Unavailable dish"
                      )}
                    </h2>
                    <span className="shrink-0 text-sm font-medium tabular-nums">
                      {line.error
                        ? "—"
                        : formatMoney(line.totalMinor, menu.currency)}
                    </span>
                  </div>
                  {!line.error && (
                    <p className="mt-2 text-xs text-muted">
                      {formatMoney(line.product!.priceMinor, menu.currency)}{" "}
                      base · {formatMoney(line.unitPriceMinor, menu.currency)}{" "}
                      each
                    </p>
                  )}
                  {line.options.length > 0 && (
                    <ul className="mt-3 space-y-1 text-xs leading-5 text-muted">
                      {line.options.map((option) => (
                        <li
                          key={option.id}
                          className="flex justify-between gap-3"
                        >
                          <span>
                            {option.group}: {option.name}
                          </span>
                          <span className="shrink-0 tabular-nums">
                            {option.priceAdjustmentMinor
                              ? `+${formatMoney(option.priceAdjustmentMinor, menu.currency)} / each`
                              : "Included"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {line.error && (
                    <p className="mt-3 text-xs leading-5 text-amber-900">
                      {line.error}{" "}
                      {line.product && (
                        <Link
                          href={
                            productPath(
                              menu.slug,
                              line.productId,
                              token,
                            ) as Route
                          }
                          prefetch={false}
                          className="underline"
                        >
                          Choose again
                        </Link>
                      )}
                    </p>
                  )}
                </div>
              </div>
              <div className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-4">
                <QuantityControl
                  value={line.quantity}
                  onChange={(quantity) => setQuantity(line.key, quantity)}
                  label={line.product?.name ?? "Unavailable dish"}
                  disabled={!!line.error}
                />
                <button
                  type="button"
                  onClick={() => {
                    remove(line.key);
                    setAnnouncement(
                      `${line.product?.name ?? "Dish"} removed from your bag.`,
                    );
                  }}
                  aria-label={`Remove ${line.product?.name ?? "unavailable dish"}`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm text-danger transition-colors hover:bg-danger-soft"
                >
                  <Trash2 size={15} aria-hidden="true" />
                  Remove
                </button>
              </div>
            </article>
          ))}
        </section>
        <aside
          className="rounded-3xl border border-line bg-[#efeee5] p-6 lg:sticky lg:top-8 sm:p-8"
          aria-labelledby="summary-title"
        >
          <h2 id="summary-title" className="font-display text-2xl">
            Order total
          </h2>
          <dl className="mt-7 space-y-4 text-sm">
            <div className="flex justify-between gap-3 text-lg font-semibold">
              <dt>Total</dt>
              <dd aria-live="polite" className="tabular-nums">
                {formatMoney(subtotalMinor, menu.currency)}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-[11px] leading-5 text-muted">
            Pay restaurant staff directly. Nothing is sent until you place your order.
          </p>
          {hasInvalidItems ? (
            <button
              disabled
              aria-describedby="order-review-note"
              className="mt-7 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-accent/15 px-4 text-sm font-medium text-accent"
            >
              Review changed dishes first
            </button>
          ) : (
            <Link
              href={customerPath(menu.slug, "review", token) as Route}
              prefetch={false}
              aria-describedby="order-review-note"
              className="mt-7 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent/90"
            >
              Review Order
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          )}
          <p
            id="order-review-note"
            className="mt-3 text-center text-xs leading-6 text-muted"
          >
            {hasInvalidItems
              ? "Update or remove unavailable dishes to continue."
              : context.mode === "demo"
                ? "Preview the review screen. Demo mode cannot send an order."
                : context.table.status !== "valid"
                  ? "Scan the QR code at your table before placing an order."
                  : "Nothing is sent until you confirm your order."}
          </p>
        </aside>
      </div>
      <p className="sr-only" role="status">
        {announcement}
      </p>
    </div>
  );
}
