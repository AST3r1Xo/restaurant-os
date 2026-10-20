"use client";
import Link from "next/link";
import Image from "next/image";
import type { Route } from "next";
import { Trash2, Utensils, MessageSquareText } from "lucide-react";
import { useState } from "react";
import { useCart } from "./cart-provider";
import { QuantityControl } from "@/components/quantity-control";
import { productPath } from "@/lib/routes";
import { formatMoney } from "@/lib/format";
import { MAX_SPECIAL_REQUEST_LENGTH } from "../special-request";
import { cartLineKey } from "../model";
import type { OrderReview } from "@/features/orders/types";
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

export function CartItems({
  disabled = false,
  review,
}: {
  disabled?: boolean;
  review?: OrderReview;
}) {
  const { lines, setQuantity, setNotes, remove, menu, context } = useCart();
  const [announcement, setAnnouncement] = useState("");
  const [noteError, setNoteError] = useState<string>();
  const token =
    context.table.status === "valid" ? context.table.token : undefined;
  return (
    <>
      {noteError && (
        <p
          role="alert"
          className="mb-5 rounded-xl bg-attention-soft p-4 text-sm leading-6 text-attention"
        >
          {noteError}
        </p>
      )}
      <section aria-label="Dishes in your bag" className="space-y-4">
        {lines.map((original) => {
          const quoted = review?.items.find(
            (item) =>
              cartLineKey({
                productId: item.productId,
                optionIds: item.options.map((option) => option.id),
                notes: item.notes,
              }) === original.key,
          );
          const line = quoted
            ? {
                ...original,
                product: original.product
                  ? {
                      ...original.product,
                      name: quoted.productName,
                      priceMinor: quoted.basePriceMinor,
                    }
                  : undefined,
                unitPriceMinor: quoted.unitPriceMinor,
                totalMinor: quoted.lineTotalMinor,
                options: quoted.options.map((option) => ({
                  ...option,
                  group: option.groupName,
                })),
              }
            : original;
          return (
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
              <details
                className="disclosure mt-4 rounded-xl border border-line bg-background/50 px-3.5"
                open={line.notes ? true : undefined}
              >
                <summary className="flex min-h-11 items-center gap-2 text-xs font-medium text-accent">
                  <MessageSquareText size={15} aria-hidden="true" />
                  {line.notes
                    ? "Special request · edit"
                    : "Add a special request"}
                </summary>
                <textarea
                  aria-label={`Special request for ${line.product?.name ?? "this dish"}`}
                  disabled={disabled}
                  defaultValue={line.notes ?? ""}
                  maxLength={MAX_SPECIAL_REQUEST_LENGTH}
                  rows={3}
                  placeholder="e.g. No onions, sauce on the side…"
                  onBlur={(event) => {
                    const error = setNotes(line.key, event.target.value);
                    setNoteError(error ?? undefined);
                    if (error) event.currentTarget.value = line.notes ?? "";
                  }}
                  className="mb-3 min-h-24 w-full resize-y rounded-xl border border-line bg-white px-3 py-2.5 text-base leading-6 placeholder:text-muted"
                />
              </details>
              <div className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-4">
                <QuantityControl
                  value={line.quantity}
                  onChange={(quantity) => setQuantity(line.key, quantity)}
                  label={line.product?.name ?? "Unavailable dish"}
                  disabled={disabled || !!line.error}
                />
                <button
                  type="button"
                  disabled={disabled}
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
          );
        })}
      </section>
      <p className="sr-only" role="status">
        {announcement}
      </p>
    </>
  );
}
