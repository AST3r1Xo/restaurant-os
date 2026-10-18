"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  LoaderCircle,
  MapPin,
  ShieldCheck,
  ShoppingBag,
} from "lucide-react";
import { useCart } from "@/features/cart/components/cart-provider";
import { cartLineKey } from "@/features/cart/model";
import { cartStorageKey, parseCart } from "@/features/cart/persistence";
import { EmptyState } from "@/components/empty-state";
import { customerPath, orderPath } from "@/lib/routes";
import { formatMoney } from "@/lib/format";
import {
  reviewOrderAction,
  recoverOrderAction,
  submitOrderAction,
} from "../actions";
import type { ConfirmedOrder, OrderReview } from "../types";
import {
  discardStoredSubmission,
  intentFingerprint,
  readStoredSubmission,
  saveStoredSubmission,
  withSubmissionLock,
  waitForOrderResponse,
  submissionFailureMessage,
} from "../submission-persistence";
import type { StoredSubmission } from "../submission-persistence";
import { OrderSummary } from "./order-summary";
import type { OrderSummaryLine } from "./order-summary";

function summaryLines(
  review: OrderReview | ConfirmedOrder,
): OrderSummaryLine[] {
  return review.items.map((item) => ({
    key: cartLineKey({
      productId: item.productId,
      optionIds: item.options.map((option) => option.id),
    }),
    name: item.productName,
    quantity: item.quantity,
    unitPriceMinor: item.unitPriceMinor,
    totalMinor: item.lineTotalMinor,
    options: item.options.map((option) => ({
      ...option,
      group: option.groupName,
    })),
  }));
}
const definitiveErrors = new Set([
  "invalid_request",
  "restaurant_unavailable",
  "table_invalid",
  "product_unavailable",
  "options_invalid",
  "quantity_invalid",
  "review_expired",
  "order_changed",
  "session_changed",
  "visit_ended",
  "idempotency_conflict",
]);

export function OrderReviewContent() {
  const cart = useCart();
  const {
    ready,
    menu,
    context,
    items,
    lines,
    subtotalMinor,
    hasInvalidItems,
    clearPurchased,
    storageError,
  } = cart;
  const router = useRouter();
  const scope = useMemo(
    () => ({
      restaurantId: menu.id,
      mode: context.mode,
      currency: menu.currency,
      visitKey:
        context.table.status === "valid" ? context.table.visitKey : undefined,
    }),
    [menu.id, context.mode, menu.currency, context.table],
  );
  const tableToken =
    context.table.status === "valid" ? context.table.token : undefined;
  const [review, setReview] = useState<OrderReview>();
  const [attempt, setAttempt] = useState<StoredSubmission>();
  const [restored, setRestored] = useState(context.mode === "demo");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [blocked, setBlocked] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [lastOrderId, setLastOrderId] = useState<string>();
  const [reviewedIntents, setReviewedIntents] = useState<string>();
  const currentFingerprint = intentFingerprint(items);

  const finish = useCallback(
    (order: ConfirmedOrder, saved: StoredSubmission) => {
      try {
        saveStoredSubmission(window.localStorage, scope, {
          ...saved,
          confirmedOrderId: order.id,
        });
      } catch {
        // The original attempt remains recoverable; server-confirmed success
        // must not be presented as a failed order because storage changed.
      }
      clearPurchased(order.id, saved.request.items);
      router.replace(
        orderPath(menu.slug, order.id, saved.request.tableToken) as Route,
      );
    },
    [clearPurchased, menu.slug, router, scope],
  );

  useEffect(() => {
    if (!ready || context.mode === "demo") return;
    let cancelled = false;
    async function restore() {
      let restoringAttempt = false;
      try {
        const saved = readStoredSubmission(window.localStorage, scope);
        if (!saved) {
          if (!cancelled) setRestored(true);
          return;
        }
        if (saved.confirmedOrderId) {
          clearPurchased(saved.confirmedOrderId, saved.request.items);
          if (!cancelled) {
            setLastOrderId(saved.confirmedOrderId);
            setRestored(true);
          }
          return;
        }
        if (!cancelled) {
          setAttempt(saved);
          setBusy(true);
        }
        restoringAttempt = true;
        const result = await waitForOrderResponse(
          recoverOrderAction(menu.slug, saved.request.idempotencyKey),
        );
        if (cancelled) return;
        if (result.ok && result.order) {
          finish(result.order, saved);
          return;
        }
        if (!result.ok) {
          setError(result.message);
          if (result.code === "session_lost") setBlocked(true);
        } else {
          setError(
            "Your previous request has not been confirmed. Retry safely below using the same order reference.",
          );
        }
      } catch (cause) {
        if (!cancelled) {
          setError(submissionFailureMessage(cause));
          setBlocked(!restoringAttempt);
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
          setRestored(true);
        }
      }
    }
    void restore();
    return () => {
      cancelled = true;
    };
  }, [ready, context.mode, scope, menu.slug, clearPurchased, finish]);

  const checkOrder = useCallback(async () => {
    if (
      !tableToken ||
      !items.length ||
      hasInvalidItems ||
      !menu.isAcceptingOrders ||
      context.mode === "demo"
    )
      return;
    setBusy(true);
    setError(undefined);
    setReview(undefined);
    setAccepted(false);
    const checkingFingerprint = intentFingerprint(items);
    try {
      const runReview = () =>
        waitForOrderResponse(
          reviewOrderAction({
            restaurantSlug: menu.slug,
            tableToken,
            items,
            visitKey: scope.visitKey,
          }),
        );
      // Initial anonymous sign-in also needs cross-restaurant coordination:
      // whichever tab creates the guest first supplies the shared cookie.
      const result = navigator.locks
        ? await navigator.locks.request("restaurant-os:guest-review", runReview)
        : await runReview();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const changed =
        result.review.totalMinor !== subtotalMinor ||
        result.review.items.some((item) => {
          const line = lines.find(
            (line) =>
              line.key ===
              cartLineKey({
                productId: item.productId,
                optionIds: item.options.map((option) => option.id),
              }),
          );
          return (
            !line ||
            line.product?.name !== item.productName ||
            line.unitPriceMinor !== item.unitPriceMinor ||
            line.options.length !== item.options.length ||
            line.options.some((option) => {
              const selected = item.options.find(
                (selected) => selected.id === option.id,
              );
              return (
                selected?.priceAdjustmentMinor !==
                option.priceAdjustmentMinor ||
                selected?.name !== option.name ||
                selected?.groupName !== option.group
              );
            })
          );
        });
      setReview(result.review);
      setReviewedIntents(checkingFingerprint);
      setUpdated(changed);
      setAccepted(!changed);
    } catch {
      setError(
        "We couldn’t check the current menu. Your bag is safe. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }, [
    tableToken,
    items,
    hasInvalidItems,
    context.mode,
    menu.slug,
    menu.isAcceptingOrders,
    subtotalMinor,
    lines,
    scope.visitKey,
  ]);

  // Start the first review once the persisted bag is restored. Later bag/menu
  // changes require an explicit fresh check instead of replacing a reviewed order.
  useEffect(() => {
    if (!restored || !ready || attempt || review || busy || error || blocked)
      return;
    if (
      context.mode !== "live" ||
      !tableToken ||
      !items.length ||
      hasInvalidItems ||
      !menu.isAcceptingOrders
    )
      return;
    const timer = setTimeout(() => {
      void checkOrder();
    }, 0);
    return () => clearTimeout(timer);
  }, [
    restored,
    ready,
    attempt,
    review,
    busy,
    error,
    blocked,
    context.mode,
    tableToken,
    items.length,
    hasInvalidItems,
    menu.isAcceptingOrders,
    checkOrder,
  ]);

  async function placeOrder() {
    if (
      busy ||
      blocked ||
      context.mode !== "live" ||
      (!attempt && (!review || !accepted))
    )
      return;
    setBusy(true);
    setError(undefined);
    try {
      await withSubmissionLock(scope, navigator.locks, async () => {
        let saved = readStoredSubmission(window.localStorage, scope);
        if (
          saved?.confirmedOrderId &&
          saved.review.reviewId === review?.reviewId
        ) {
          const recovered = await waitForOrderResponse(
            recoverOrderAction(menu.slug, saved.request.idempotencyKey),
          );
          if (recovered.ok && recovered.order) finish(recovered.order, saved);
          else if (!recovered.ok) {
            setError(recovered.message);
            if (recovered.code === "session_lost") setBlocked(true);
          }
          return;
        }
        if (!saved || saved.confirmedOrderId) {
          if (
            !review ||
            !tableToken ||
            reviewedIntents !== currentFingerprint ||
            !accepted
          )
            throw new Error(
              "Your bag has changed. Please check your order again.",
            );
          const latestItems = parseCart(
            window.localStorage.getItem(cartStorageKey(scope)),
            scope,
          );
          if (intentFingerprint(latestItems) !== currentFingerprint)
            throw new Error(
              "Your bag changed in another tab. Please review it again before placing an order.",
            );
          if (Date.parse(review.expiresAt) <= Date.now()) {
            setReview(undefined);
            throw new Error(
              "This review has expired. Check the current menu again before placing your order.",
            );
          }
          saved = {
            version: 2,
            restaurantId: scope.restaurantId,
            mode: "live",
            currency: scope.currency,
            visitKey: scope.visitKey,
            request: {
              restaurantSlug: menu.slug,
              tableToken,
              visitKey: scope.visitKey!,
              items,
              reviewId: review.reviewId,
              idempotencyKey: crypto.randomUUID(),
            },
            review,
          };
          saveStoredSubmission(window.localStorage, scope, saved);
        }
        setAttempt(saved);
        const recovered = await waitForOrderResponse(
          recoverOrderAction(menu.slug, saved.request.idempotencyKey),
        );
        if (!recovered.ok) {
          setError(recovered.message);
          if (recovered.code === "session_lost") setBlocked(true);
          return;
        }
        if (recovered.order) {
          finish(recovered.order, saved);
          return;
        }
        const result = await waitForOrderResponse(
          submitOrderAction(saved.request),
        );
        if (result.ok) {
          finish(result.order, saved);
          return;
        }
        setError(result.message);
        if (result.code === "session_lost") {
          setBlocked(true);
          return;
        }
        if (definitiveErrors.has(result.code)) {
          // A previous concurrent request may have committed. Resolve that
          // outcome before releasing the persisted key for a fresh review.
          const finalCheck = await waitForOrderResponse(
            recoverOrderAction(menu.slug, saved.request.idempotencyKey),
          );
          if (finalCheck.ok && finalCheck.order)
            finish(finalCheck.order, saved);
          else if (finalCheck.ok) {
            discardStoredSubmission(
              window.localStorage,
              scope,
              saved.request.idempotencyKey,
            );
            setAttempt(undefined);
            setReview(undefined);
            setAccepted(false);
          } else {
            setError(finalCheck.message);
            if (finalCheck.code === "session_lost") setBlocked(true);
          }
        }
      });
    } catch (cause) {
      setError(submissionFailureMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  const activeReview = attempt?.review ?? review;
  const menuHref = customerPath(menu.slug, "menu", tableToken) as Route;
  const bagHref = customerPath(menu.slug, "cart", tableToken) as Route;
  const summary = activeReview
    ? summaryLines(activeReview)
    : lines
      .filter((line) => !line.error)
      .map((line) => ({
        key: line.key,
        name: line.product!.name,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        totalMinor: line.totalMinor,
        options: line.options,
      }));
  const changedBag =
    !!review && reviewedIntents !== currentFingerprint && !attempt;
  const canPlace =
    restored &&
    (!!tableToken || !!attempt) &&
    !storageError &&
    !blocked &&
    (attempt ||
      (menu.isAcceptingOrders &&
        review &&
        accepted &&
        !changedBag &&
        !hasInvalidItems));
  const canRecheck = !attempt && !busy && (!review || changedBag) &&
    !hasInvalidItems && menu.isAcceptingOrders && !blocked && !storageError;

  if (!ready || !restored)
    return (
      <div role="status" className="mx-auto max-w-4xl py-16">
        <p className="text-sm text-muted">Loading your selection…</p>
        <div className="mt-6 h-48 animate-pulse rounded-3xl bg-accent-soft" />
      </div>
    );
  if (!items.length && !attempt)
    return (
      <div className="space-y-5">
        <EmptyState
          icon={ShoppingBag}
          eyebrow="Review Order"
          title="Your bag is empty"
          description="Add a dish from the menu before placing an order."
          href={menuHref}
          action="Explore the menu"
        />
        {lastOrderId && (
          <Link
            href={orderPath(menu.slug, lastOrderId, tableToken) as Route}
            prefetch={false}
            className="flex min-h-11 items-center justify-center text-sm text-accent underline"
          >
            View your last confirmed order
          </Link>
        )}
      </div>
    );

  return (
    <div className="motion-enter mx-auto max-w-5xl pb-10">
      <Link
        href={bagHref}
        prefetch={false}
        className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm text-muted hover:text-accent"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        Back to your bag
      </Link>
      <div className="mb-8">
        <h1 className="font-display text-4xl sm:text-5xl">
          Review your order
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-7 text-muted">
          Check your dishes, then press Place Order.
        </p>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[1.5fr_1fr] lg:gap-8">
        <section aria-label="Your reviewed selection" className="space-y-5">
          {attempt && (
            <p
              role="status"
              className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"
            >
              Checking whether your order was received. You can safely retry;
              we won’t send the same order twice. Any new dishes stay in your bag.
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"
            >
              {error}
            </p>
          )}
          {!menu.isAcceptingOrders && context.mode === "live" && !attempt && (
            <p
              role="status"
              className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"
            >
              The restaurant is not accepting new orders right now. Your
              selections stay saved. Please ask our team for help.
            </p>
          )}
          {hasInvalidItems && !attempt && (
            <p
              role="alert"
              className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"
            >
              Unfortunately, some dishes or options are no longer available.{" "}
              <Link href={bagHref} prefetch={false} className="underline">
                Update your bag
              </Link>{" "}
              before confirming.
            </p>
          )}
          {changedBag && (
            <p
              role="status"
              className="rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900"
            >
              Your bag changed in another tab. Check your updated selection
              before confirming.
            </p>
          )}
          {updated && review && !attempt && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
              <p>
                The menu details or prices have changed. Please review your
                updated order below.
              </p>
              <button
                type="button"
                onClick={() => setAccepted(true)}
                disabled={accepted || busy}
                className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full border border-amber-900/20 px-4 text-xs font-semibold disabled:opacity-60"
              >
                {accepted && <Check size={14} aria-hidden="true" />}
                {accepted ? "Updated order accepted" : "Accept updated order"}
              </button>
            </div>
          )}
          <OrderSummary
            lines={summary}
            currency={activeReview?.currency ?? menu.currency}
            totalMinor={activeReview?.totalMinor ?? subtotalMinor}
          />
        </section>
        <aside
          aria-labelledby="confirm-title"
          className="rounded-3xl border border-line bg-[#efeee5] p-6 sm:p-8 lg:sticky lg:top-8"
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
            Your restaurant
          </p>
          <h2 id="confirm-title" className="mt-3 font-display text-3xl">
            {activeReview?.restaurant.name ?? menu.name}
          </h2>
          <p className="mt-3 flex items-center gap-2 text-sm text-accent">
            <MapPin size={15} aria-hidden="true" />
            {activeReview?.table.label ??
              (context.table.status === "valid"
                ? context.table.label
                : "Table QR required")}
          </p>
          <div className="mt-7 border-t border-line pt-5">
            <span className="text-xs text-muted">Order total</span>
            <p className="mt-2 font-display text-4xl tabular-nums">
              {formatMoney(
                activeReview?.totalMinor ?? subtotalMinor,
                activeReview?.currency ?? menu.currency,
              )}
            </p>
          </div>
          <p className="mt-5 text-xs leading-6 text-muted">
            Payment is handled directly by restaurant staff. No payment details
            are required.
          </p>
          {context.mode === "demo" ? (
            <>
              <button
                disabled
                className="mt-7 flex min-h-14 w-full items-center justify-center rounded-2xl bg-accent/15 px-4 text-sm font-medium text-accent"
              >
                Place Order · Demo preview
              </button>
              <p className="mt-3 text-center text-xs leading-6 text-muted">
                Demo mode lets you explore this screen. It cannot send an order
                to a restaurant.
              </p>
            </>
          ) : !tableToken && !attempt ? (
            <p
              role="status"
              className="mt-7 rounded-2xl border border-line bg-white/60 p-4 text-sm leading-6"
            >
              Scan the QR code at your table to place this order. Your bag will
              stay saved on this device.
            </p>
          ) : (
            <>
              <button
                type="button"
                disabled={busy || (!canPlace && !canRecheck)}
                onClick={() => void (canRecheck ? checkOrder() : placeOrder())}
                aria-describedby="confirmation-note"
                className="mt-7 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:bg-accent/15 disabled:text-accent/70"
              >
                {busy ? (
                  <>
                    <LoaderCircle
                      size={17}
                      className="animate-spin"
                      aria-hidden="true"
                    />
                    {attempt ? "Checking your order…" : "Checking the menu…"}
                  </>
                ) : (
                  <>
                    {attempt ? "Check my order" : canRecheck ? "Review updated order" : "Place Order"}
                    <ArrowRight size={16} aria-hidden="true" />
                  </>
                )}
              </button>
              <p
                id="confirmation-note"
                className="mt-3 text-center text-xs leading-6 text-muted"
              >
                {blocked
                  ? "Please ask restaurant staff to check your order. A table QR cannot restore a lost guest session."
                  : storageError
                    ? "Your browser must allow local storage so we can keep your order safe during a connection interruption."
                    : "Only a confirmed response means your order has reached the restaurant."}
              </p>
            </>
          )}
          <p className="mt-5 flex items-start gap-2 border-t border-line pt-5 text-[11px] leading-5 text-muted">
            <ShieldCheck
              size={15}
              className="mt-0.5 shrink-0 text-accent"
              aria-hidden="true"
            />
            {attempt
              ? "Your saved order reference prevents duplicate submissions."
              : "Prices and availability are checked again when you confirm."}
          </p>
        </aside>
      </div>
    </div>
  );
}
