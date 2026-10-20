"use client";
import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  ArrowLeft,
  LoaderCircle,
  ShoppingBag,
  MessageSquareText,
} from "lucide-react";
import clsx from "clsx";
import type { MenuProduct } from "@/features/menu/types";
import { useCart } from "@/features/cart/components/cart-provider";
import { validateSelection } from "@/features/cart/model";
import { QuantityControl } from "@/components/quantity-control";
import { customerPath } from "@/lib/routes";
import { formatMoney } from "@/lib/format";
import { ProductMedia } from "@/features/ar/components/product-media";
import { createDraftStore } from "../draft";
import { MAX_SPECIAL_REQUEST_LENGTH } from "@/features/cart/special-request";
import { ProductAddedActions } from "./product-added-actions";
import { NextStep } from "@/components/next-step";

export function ProductDetails({
  product,
  backToMenu,
}: {
  product: MenuProduct;
  backToMenu?: string;
}) {
  const {
    add,
    context,
    menu,
    scope,
    storageError: bagStorageError,
  } = useCart();
  const [draft] = useState(() =>
    createDraftStore(scope, product, () => window.sessionStorage),
  );
  const { quantity, optionIds, notes, storageError } = useSyncExternalStore(
    draft.subscribe,
    draft.getSnapshot,
    draft.getServerSnapshot,
  );
  const { setQuantity, setOptionIds } = draft;
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [added, setAdded] = useState(false);
  const token =
    context.table.status === "valid" ? context.table.token : undefined;
  const unitPrice =
    product.priceMinor +
    product.modifierGroups
      .flatMap((group) => group.options)
      .filter((option) => optionIds.includes(option.id))
      .reduce((sum, option) => sum + option.priceAdjustmentMinor, 0);
  const validation = validateSelection(product, optionIds, quantity);
  const impossible = product.modifierGroups.some(
    (group) => group.options.length < group.minSelections,
  );
  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (validation) {
      setMessage(validation);
      document
        .getElementById("customizations")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setPending(true);
    setMessage(undefined);
    setAdded(false);
    try {
      const error = await add(product, optionIds, quantity, notes);
      if (error) setMessage(error);
      else {
        setAdded(true);
        setMessage(
          `${quantity} ${quantity === 1 ? "dish" : "dishes"} added to your bag.`,
        );
      }
    } catch {
      setMessage("We couldn’t add this dish. Please try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="motion-enter mx-auto max-w-5xl pb-48 md:pb-10">
      <Link
        href={(backToMenu ?? customerPath(menu.slug, "menu", token)) as Route}
        prefetch={false}
        className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm text-muted hover:text-accent"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {added ? "Add more dishes" : "Menu"}
      </Link>
      <div className="grid gap-5 md:grid-cols-[1.05fr_1fr] md:gap-12">
        <ProductMedia product={product} />
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
            From our kitchen
          </p>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
            <h1 className="max-w-xs font-display text-3xl leading-[1.12] sm:text-5xl">
              {product.name}
            </h1>
            <span className="pt-2 text-lg font-medium tabular-nums text-accent">
              {formatMoney(product.priceMinor, menu.currency)}
            </span>
          </div>
          {product.description && (
            <p className="mt-5 text-sm leading-7 text-muted">
              {product.description}
            </p>
          )}
          {product.ingredients.length > 0 && (
            <div className="mt-6 border-t border-line pt-5">
              <h2 className="text-xs font-semibold uppercase tracking-wider">
                The ingredients
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                {product.ingredients.join(" · ")}
              </p>
            </div>
          )}
          <details className="mt-4 rounded-xl border border-line bg-white/50 px-4">
            <summary className="flex min-h-12 items-center justify-between gap-3 text-xs font-medium">
              Allergens & dietary information
              <span className="text-muted">+</span>
            </summary>
            <div className="pb-4 text-xs leading-6 text-muted">
              {product.allergens.length ? (
                <p>
                  <span className="font-semibold text-foreground">
                    Contains:{" "}
                  </span>
                  {product.allergens.join(", ")}
                </p>
              ) : (
                <p>Allergen information is not listed for this dish.</p>
              )}
              {product.tags.length > 1 && (
                <p>{product.tags.slice(1).join(" · ")}</p>
              )}
              <p className="mt-2">
                Options may introduce additional allergens. Please speak with
                our team about allergies and dietary requirements.
              </p>
            </div>
          </details>
          <form onSubmit={onSubmit} className="mt-8">
            {!added && <div className="mb-6"><NextStep title={validation ? "Choose your options, then add to bag" : "Ready to add to your bag"}>
              {validation ? "Complete the marked choices below. Then tap the green Add to bag button." : "Tap Add to bag below. You can keep browsing before sending your order."}
            </NextStep></div>}
            {storageError && (
              <p role="status" className="mb-4 text-xs leading-6 text-muted">
                Your browser cannot save this selection between page reloads.
                Keep this page open while previewing.
              </p>
            )}
            {product.modifierGroups.length > 0 && (
              <div id="customizations">
                <h2 className="font-display text-2xl">Choose your options</h2>
                <p className="mt-1 text-xs leading-6 text-muted">
                  Complete the required choices below.
                </p>
                {product.modifierGroups.map((group) => {
                  const count = group.options.filter((option) =>
                    optionIds.includes(option.id),
                  ).length;
                  return (
                    <fieldset
                      key={group.id}
                      disabled={pending}
                      className="mt-6 border-t border-line pt-5"
                    >
                      <legend className="float-left mb-3 flex w-full flex-wrap items-center justify-between gap-2 text-sm font-medium">
                        <span>{group.name}</span>
                        <span
                          className={clsx(
                            "rounded-full px-2.5 py-1 text-xs font-semibold",
                            group.minSelections > 0
                              ? "bg-attention-soft text-attention ring-1 ring-attention/30"
                              : "bg-white text-muted",
                          )}
                        >
                          {group.minSelections > 0 ? "Required" : "Optional"} ·{" "}
                          {group.selectionType === "single"
                            ? "Choose 1"
                            : `Choose ${group.minSelections ? `${group.minSelections}–` : "up to "}${group.maxSelections}`}
                        </span>
                      </legend>
                      <div className="clear-both space-y-2">
                        {group.description && (
                          <p className="mb-3 text-xs leading-5 text-muted">
                            {group.description}
                          </p>
                        )}
                        {!group.options.length && (
                          <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
                            These options are currently unavailable.
                          </p>
                        )}
                        {group.selectionType === "single" &&
                          group.minSelections === 0 && (
                            <label
                              className={clsx(
                                "modifier-choice",
                                !count && "modifier-selected",
                              )}
                            >
                              <input
                                type="radio"
                                name={group.id}
                                checked={!count}
                                onChange={() => {
                                  setOptionIds((ids) =>
                                    ids.filter(
                                      (id) =>
                                        !group.options.some(
                                          (option) => option.id === id,
                                        ),
                                    ),
                                  );
                                  setAdded(false);
                                }}
                                className="size-4 accent-accent"
                              />
                              <span className="flex-1 text-sm">
                                No preference
                              </span>
                            </label>
                          )}
                        {group.options.map((option) => {
                          const checked = optionIds.includes(option.id);
                          const disabled =
                            group.selectionType === "multiple" &&
                            !checked &&
                            count >= group.maxSelections;
                          return (
                            <label
                              key={option.id}
                              className={clsx(
                                "modifier-choice",
                                checked && "modifier-selected",
                                disabled && "opacity-45",
                              )}
                            >
                              <input
                                type={
                                  group.selectionType === "single"
                                    ? "radio"
                                    : "checkbox"
                                }
                                name={group.id}
                                checked={checked}
                                disabled={disabled}
                                onChange={() => {
                                  setOptionIds((ids) =>
                                    group.selectionType === "single"
                                      ? [
                                          ...ids.filter(
                                            (id) =>
                                              !group.options.some(
                                                (option) => option.id === id,
                                              ),
                                          ),
                                          option.id,
                                        ]
                                      : checked
                                        ? ids.filter((id) => id !== option.id)
                                        : [...ids, option.id],
                                  );
                                  setMessage(undefined);
                                  setAdded(false);
                                }}
                                className="size-4 shrink-0 accent-accent"
                              />
                              <span className="flex-1 text-sm">
                                {option.name}
                              </span>
                              <span className="text-xs tabular-nums text-muted">
                                {option.priceAdjustmentMinor
                                  ? `+${formatMoney(option.priceAdjustmentMinor, menu.currency)}`
                                  : "Included"}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  );
                })}
              </div>
            )}
            <div className="mt-6 rounded-2xl border border-line bg-white p-4 sm:p-5">
              <label
                htmlFor="dish-special-request"
                className="flex items-center gap-2 text-sm font-medium"
              >
                <MessageSquareText
                  size={17}
                  className="text-accent"
                  aria-hidden="true"
                />
                Special request
                <span className="ml-auto text-xs font-normal text-muted">
                  Optional
                </span>
              </label>
              <textarea
                id="dish-special-request"
                name="special-request"
                value={notes ?? ""}
                onChange={(event) => {
                  draft.setNotes(event.target.value);
                  setAdded(false);
                }}
                maxLength={MAX_SPECIAL_REQUEST_LENGTH}
                rows={3}
                disabled={pending}
                placeholder="e.g. No onions, sauce on the side…"
                aria-describedby="dish-special-request-help"
                className="mt-3 min-h-24 w-full resize-y rounded-xl border border-line bg-background/60 px-3.5 py-3 text-base leading-6 placeholder:text-muted focus:border-accent"
              />
              <p
                id="dish-special-request-help"
                className="mt-2 flex justify-between gap-3 text-xs leading-5 text-muted"
              >
                <span>
                  Sent to our kitchen. For allergies, please speak to our team.
                </span>
                <span className="shrink-0 tabular-nums">
                  {(notes ?? "").length}/{MAX_SPECIAL_REQUEST_LENGTH}
                </span>
              </p>
            </div>
            <div className="mt-8 hidden items-center justify-between border-t border-line pt-6 md:flex">
              <div>
                <h2 className="text-sm font-medium">Quantity</h2>
              </div>
              <QuantityControl
                value={quantity}
                onChange={(value) => {
                  setQuantity(value);
                  setAdded(false);
                }}
                label={product.name}
                disabled={pending}
              />
            </div>
            <div
              aria-live="polite"
              aria-atomic="true"
              className={clsx(
                "mt-4 text-sm leading-6",
                added ? "text-accent" : "text-amber-900",
              )}
            >
              {message}
              {impossible && (
                <p>
                  This dish’s customizations are currently unavailable. Please
                  choose another dish.
                </p>
              )}
            </div>
            <div className="product-dock fixed inset-x-0 z-30 border-t border-line bg-background/95 px-4 py-3 backdrop-blur-md md:static md:mt-6 md:border-0 md:bg-transparent md:p-0">
              <div className="mx-auto flex max-w-lg items-center gap-3">
                {!added && (
                  <div className="md:hidden">
                    <span className="sr-only">Quantity</span>
                    <QuantityControl
                      value={quantity}
                      onChange={(value) => {
                        setQuantity(value);
                        setAdded(false);
                      }}
                      label={product.name}
                      disabled={pending}
                    />
                  </div>
                )}
                {added ? (
                  <ProductAddedActions
                    menuHref={
                      backToMenu ?? customerPath(menu.slug, "menu", token)
                    }
                    bagHref={customerPath(menu.slug, "cart", token)}
                    saved={!bagStorageError}
                  />
                ) : (
                  <button
                    type="submit"
                    disabled={pending || impossible}
                    className="flex min-h-15 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl bg-accent px-3 py-2 text-base font-bold text-white shadow-lg transition-colors hover:bg-[#263e2f] disabled:cursor-wait disabled:opacity-60 md:flex-row md:justify-between md:px-5 md:py-4"
                  >
                    <span className="flex items-center gap-2">
                      {pending ? (
                        <LoaderCircle
                          size={17}
                          className="animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <ShoppingBag
                          size={17}
                          className="hidden md:block"
                          aria-hidden="true"
                        />
                      )}
                      {pending ? "Adding…" : "Add to bag"}
                    </span>
                    <span className="tabular-nums">
                      {formatMoney(unitPrice * quantity, menu.currency)}
                    </span>
                  </button>
                )}
              </div>
              {message && !added && (
                <p
                  role="status"
                  className="mx-auto mt-2 max-w-lg text-xs leading-5 text-danger md:hidden"
                >
                  {message}
                </p>
              )}
            </div>
            <p className="mt-3 text-center text-[11px] leading-5 text-muted">
              Adding to your bag does not send an order. Place your order from
              your bag when you’re ready.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
