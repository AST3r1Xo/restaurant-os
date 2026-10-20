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
  ShoppingBag,
} from "lucide-react";
import { useCart } from "@/features/cart/components/cart-provider";
import { CartItems } from "@/features/cart/components/cart-items";
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
import { reviewNeedsAcceptance } from "../review-comparison";
import { ConfirmationNextSteps } from "./confirmation-next-steps";
import { OrderSummary } from "./order-summary";
import type { OrderSummaryLine } from "./order-summary";

function summaryLines(
  review: OrderReview | ConfirmedOrder,
): OrderSummaryLine[] {
  return review.items.map((item) => ({
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
  const [submitting, setSubmitting] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string>();
  const [blocked, setBlocked] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [lastOrderId, setLastOrderId] = useState<string>();
  const [reviewedIntents, setReviewedIntents] = useState<string>();
  const currentFingerprint = intentFingerprint(items);

  const finish = useCallback(
    (order: ConfirmedOrder, saved: StoredSubmission) => {
      // Server proof already exists. Do not flash an empty bag or permit a
      // second submission while the protected receipt route is loading.
      setRedirecting(true);
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
        if (result.refresh) router.refresh();
        return;
      }
      const changed = reviewNeedsAcceptance(
        result.review,
        lines,
        subtotalMinor,
      );
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
    router,
  ]);

  // Validate the editable bag in the background. A fresh quote never submits
  // an order; unexpected catalog changes still need explicit acceptance.
  useEffect(() => {
    if (
      !restored ||
      !ready ||
      attempt ||
      busy ||
      error ||
      blocked ||
      storageError
    )
      return;
    if (review && reviewedIntents === currentFingerprint) return;
    if (
      context.mode !== "live" ||
      !tableToken ||
      !items.length ||
      hasInvalidItems ||
      !menu.isAcceptingOrders
    )
      return;
    const timer = setTimeout(
      () => {
        void checkOrder();
      },
      review ? 500 : 0,
    );
    return () => clearTimeout(timer);
  }, [
    restored,
    ready,
    attempt,
    review,
    reviewedIntents,
    currentFingerprint,
    busy,
    error,
    blocked,
    storageError,
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
    setSubmitting(true);
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
      setSubmitting(false);
    }
  }

  const activeReview = attempt?.review ?? review;
  const menuHref = customerPath(menu.slug, "menu", tableToken) as Route;
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
          notes: line.notes,
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
  const canRecheck =
    !!error &&
    !attempt &&
    !busy &&
    (!review || changedBag) &&
    !hasInvalidItems &&
    menu.isAcceptingOrders &&
    !blocked &&
    !storageError;
  const checkingPrices =
    context.mode === "live" &&
    !!tableToken &&
    menu.isAcceptingOrders &&
    !hasInvalidItems &&
    !blocked &&
    !storageError &&
    !attempt &&
    !error &&
    (!review || changedBag);

  if (!ready || !restored)
    return (
      <div role="status" className="mx-auto max-w-4xl py-16">
        <p className="text-sm text-muted">Loading your selection…</p>
        <div className="mt-6 h-48 animate-pulse rounded-3xl bg-accent-soft" />
      </div>
    );
  if (redirecting)
    return (
      <div className="mx-auto max-w-lg rounded-3xl border border-line bg-white px-6 py-8 text-center">
        <Check size={32} className="mx-auto text-accent" aria-hidden="true" />
        <h1 className="mt-4 font-display text-3xl">Order sent.</h1>
        <p role="status" className="mt-3 text-sm leading-6 text-muted">
          The restaurant has your order. Opening your receipt…
        </p>
        <ConfirmationNextSteps
          slug={menu.slug}
          tableToken={tableToken}
          cancelled={false}
          menuAvailable={true}
        />
      </div>
    );
  if (!items.length && !attempt)
    return (
      <div className="space-y-5">
        <EmptyState
          icon={ShoppingBag}
          eyebrow="Your bag"
          title="Your bag is empty"
          description={
            lastOrderId
              ? "Your previous order has already been sent. Browse the menu to start another order."
              : "Choose your dishes, then send them together from here."
          }
          href={menuHref}
          action="Explore the menu"
        />
        {lastOrderId && (
          <Link
            href={orderPath(menu.slug, lastOrderId, tableToken) as Route}
            prefetch={false}
            className="flex min-h-11 items-center justify-center text-sm text-accent underline"
          >
            View your sent order
          </Link>
        )}
      </div>
    );

  return (
    <div className="motion-enter mx-auto max-w-5xl pb-28 lg:pb-10">
      <Link
        href={menuHref}
        prefetch={false}
        className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm text-muted hover:text-accent"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        Add more dishes
      </Link>
      <div className="mb-8">
        <h1 className="font-display text-4xl sm:text-5xl">Your bag</h1>
        <p className="mt-4 max-w-xl text-sm leading-7 text-muted">
          Check your dishes here. Press Place Order once to send them to the
          restaurant.
        </p>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[1.5fr_1fr] lg:gap-8">
        <section aria-label="Your reviewed selection" className="space-y-5">
          {!attempt && (
            <p className="rounded-xl bg-attention-soft px-4 py-3 text-sm leading-6 text-attention">
              <strong>Not sent yet.</strong> You can add more dishes or edit
              your bag before placing your order.
            </p>
          )}
          {attempt && (
            <p
              role="status"
              className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"
            >
              Checking whether your order was received. You can safely retry; we
              won’t send the same order twice. Any new dishes stay in your bag.
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
              Update or remove the highlighted dishes below before placing your
              order.
            </p>
          )}
          {changedBag && (
            <p
              role="status"
              className="rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900"
            >
              Your selection changed. We’re checking the updated total.
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
          {attempt ? (
            <OrderSummary
              lines={summary}
              currency={activeReview?.currency ?? menu.currency}
              totalMinor={activeReview?.totalMinor ?? subtotalMinor}
            />
          ) : (
            <CartItems
              disabled={submitting}
              review={!changedBag ? review : undefined}
            />
          )}
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
              <div className="cart-review-dock fixed inset-x-0 z-30 border-t border-line bg-background/95 px-5 py-3 backdrop-blur-md lg:static lg:mt-7 lg:border-0 lg:bg-transparent lg:p-0">
                <button
                  disabled
                  className="mx-auto flex min-h-14 w-full max-w-lg items-center justify-center rounded-2xl bg-accent/15 px-4 text-sm font-medium text-accent"
                >
                  Place Order · Demo preview
                </button>
                <p className="mt-3 text-center text-xs leading-6 text-muted">
                  Demo mode lets you explore this screen. It cannot send an
                  order to a restaurant.
                </p>
              </div>
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
              <div className="cart-review-dock fixed inset-x-0 z-30 border-t border-line bg-background/95 px-5 py-3 backdrop-blur-md lg:static lg:mt-7 lg:border-0 lg:bg-transparent lg:p-0">
                <button
                  type="button"
                  disabled={
                    busy || checkingPrices || (!canPlace && !canRecheck)
                  }
                  onClick={() =>
                    void (canRecheck ? checkOrder() : placeOrder())
                  }
                  aria-describedby="confirmation-note"
                  aria-busy={busy || checkingPrices}
                  className="mx-auto flex min-h-14 w-full max-w-lg items-center justify-center gap-2 rounded-2xl bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:bg-accent/15 disabled:text-accent/70"
                >
                  {busy || checkingPrices ? (
                    <>
                      <LoaderCircle
                        size={17}
                        className="animate-spin"
                        aria-hidden="true"
                      />
                      {attempt || submitting
                        ? "Sending your order…"
                        : "Checking current prices…"}
                    </>
                  ) : (
                    <>
                      {hasInvalidItems && !attempt
                        ? "Update highlighted dishes"
                        : attempt
                          ? "Check my order"
                          : canRecheck
                            ? "Check order again"
                            : `Place Order · ${formatMoney(activeReview?.totalMinor ?? subtotalMinor, activeReview?.currency ?? menu.currency)}`}
                      <ArrowRight size={16} aria-hidden="true" />
                    </>
                  )}
                </button>
                <p className="mx-auto mt-2 max-w-lg text-center text-[11px] leading-5 text-muted">
                  {attempt
                    ? "Checking the same order. Please keep this page open."
                    : updated && !accepted
                      ? "The menu changed. Review and accept the updated order above."
                      : "This sends your order to the restaurant."}
                </p>
              </div>
              <p
                id="confirmation-note"
                className="mt-3 text-center text-xs leading-6 text-muted"
              >
                {blocked
                  ? "Please ask restaurant staff to check your order. A table QR cannot restore a lost guest session."
                  : storageError
                    ? "Your browser must allow local storage so we can keep your order safe during a connection interruption."
                    : "You’ll see “Order sent” as soon as the restaurant receives it."}
              </p>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
