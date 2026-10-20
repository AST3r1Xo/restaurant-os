"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useCart } from "@/features/cart/components/cart-provider";
import { guestActivityAction } from "../actions";
import { guestNotices } from "../model";
import type { GuestActivity } from "../model";
import { NotificationProvider } from "./notification-center";
import type { GuestSignalState } from "./guest-activity-tracker";

const GuestActivityTracker = dynamic(() => import("./guest-activity-tracker"), {
  ssr: false,
});

export function CustomerNotifications({
  children,
}: {
  children: React.ReactNode;
}) {
  const { context, menu } = useCart();
  const [result, setResult] = useState<{
    value?: GuestActivity;
    error?: string;
  }>({});
  const [signals, setSignals] = useState<GuestSignalState | null>(null);
  const refreshRef = useRef<(() => Promise<void>) | null>(null);
  const onRefreshReady = useCallback(
    (refresh: (() => Promise<void>) | null) => {
      refreshRef.current = refresh;
    },
    [],
  );
  const input = useMemo(
    () => ({
      slug: menu.slug,
      restaurantId: menu.id,
      ...(context.table.status === "valid"
        ? { tableToken: context.table.token, visitKey: context.table.visitKey }
        : {}),
    }),
    [menu.slug, menu.id, context.table],
  );
  useEffect(() => {
    if (context.mode === "demo") return;
    let cancelled = false;
    const load = () =>
      guestActivityAction(input)
        .then((response) => {
          if (!cancelled)
            setResult(
              response.ok
                ? { value: response.value }
                : { error: response.message },
            );
        })
        .catch(() => {
          if (!cancelled)
            setResult({
              error:
                "Live notifications could not be checked. Reconnect to see the latest updates.",
            });
        });
    const resume = () => {
      if (document.visibilityState === "visible") void load();
    };
    void load();
    window.addEventListener("online", resume);
    window.addEventListener("pageshow", resume);
    return () => {
      cancelled = true;
      window.removeEventListener("online", resume);
      window.removeEventListener("pageshow", resume);
    };
  }, [context.mode, input]);
  const enabled = context.mode === "live" && !!result.value?.visitId;
  const sameVisit =
    !!signals?.value.identityKey &&
    signals.value.identityKey === result.value?.identityKey &&
    signals.value.visitId === result.value?.visitId;
  const available = enabled
    ? !!signals && !signals.denied && signals.available && sameVisit
    : true;
  const notices = useMemo(
    () =>
      enabled && sameVisit && signals
        ? guestNotices(signals.value, menu.slug, input.tableToken)
        : [],
    [enabled, sameVisit, signals, menu.slug, input.tableToken],
  );
  const ended = enabled && !!signals?.available && !sameVisit;
  const description =
    context.mode === "demo"
      ? "Demo mode never sends real notifications."
      : enabled
        ? ended || signals?.denied
          ? "Updates for this visit are no longer available. Please ask the restaurant team for help."
          : !available
            ? "Reconnecting and checking your current visit. Private updates stay hidden until verified."
            : "Updates for this visit only, while the app is open. The restaurant team coordinates serving your table."
        : (result.error ??
          (result.value
            ? "After you place an order, updates for this visit appear here. No account or notification permission is needed."
            : "Checking for updates from your current visit…"));
  return (
    <NotificationProvider
      scope={
        enabled
          ? `guest:${result.value!.identityKey}`
          : `browse:${context.mode}:${menu.id}`
      }
      notices={notices}
      available={available}
      revoked={signals?.denied || ended}
      description={description}
      guest
      demo={context.mode === "demo"}
      refresh={async () => {
        if (enabled && refreshRef.current) await refreshRef.current();
        else {
          try {
            const response = await guestActivityAction(input);
            setResult(
              response.ok
                ? { value: response.value }
                : { error: response.message },
            );
          } catch {
            setResult({
              error:
                "Live notifications could not be checked. Please reconnect and try again.",
            });
          }
        }
      }}
    >
      {enabled && (
        <GuestActivityTracker
          key={result.value!.identityKey}
          initial={result.value!}
          input={input}
          onUpdate={setSignals}
          onRefreshReady={onRefreshReady}
        />
      )}
      {children}
    </NotificationProvider>
  );
}
