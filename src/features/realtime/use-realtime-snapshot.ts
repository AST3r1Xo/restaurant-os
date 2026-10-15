"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { realtimeAccessAction } from "./actions";
import type { RealtimeScope } from "./actions";
import { createReconciler, newestSnapshot } from "./reconcile";

export function useRealtimeSnapshot<
  T extends { fetchedAt?: string; updatedAt?: string },
>(
  initial: T,
  scope: RealtimeScope,
  load: () => Promise<
    { ok: true; value: T } | { ok: false; code: string; message: string }
  >,
) {
  const [value, setValue] = useState(initial);
  const [connection, setConnection] = useState<
    "connecting" | "live" | "offline"
  >("connecting");
  const [error, setError] = useState<string>();
  const [denied, setDenied] = useState(false);
  // Recheck even a cached App Router payload before revealing private details.
  const [privateAvailable, setPrivateAvailable] = useState(
    scope.audience.startsWith("staff"),
  );
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const scopeKey = JSON.stringify(scope);
  useEffect(() => {
    let cancelled = false;
    let cached: { token: string; until: number } | undefined;
    let subscribed = false;
    let lastVerified = Date.now();
    const guest = !(JSON.parse(scopeKey) as RealtimeScope).audience.startsWith(
      "staff",
    );
    const hidePrivate = () => {
      if (!guest) return;
      setPrivateAvailable(false);
      document
        .querySelectorAll("[data-guest-private]")
        .forEach((el) => el.setAttribute("data-access-hidden", "true"));
    };
    const refresh = createReconciler(async () => {
      try {
        const result = await loadRef.current();
        if (cancelled) return;
        if (result.ok) {
          setValue((old) => newestSnapshot(old, result.value));
          setError(undefined);
          setDenied(false);
          lastVerified = Date.now();
          if (
            guest &&
            navigator.onLine &&
            document.visibilityState === "visible"
          ) {
            setPrivateAvailable(true);
            document
              .querySelectorAll("[data-guest-private]")
              .forEach((el) => el.removeAttribute("data-access-hidden"));
          }
          if (subscribed && navigator.onLine) setConnection("live");
        } else {
          hidePrivate();
          setError(result.message);
          if (["session", "membership", "workspace"].includes(result.code)) {
            setDenied(true);
            cached = undefined;
            subscribed = false;
            setConnection("offline");
            void client.removeAllChannels();
          }
        }
      } catch {
        if (!cancelled) {
          hidePrivate();
          setError(
            "The connection was interrupted. Reconnecting to the latest restaurant data…",
          );
          setConnection("offline");
        }
      }
    });
    refreshRef.current = refresh.refresh;
    const client = createClient(async () => {
      if (cached && cached.until > Date.now()) return cached.token;
      const result = await realtimeAccessAction(
        JSON.parse(scopeKey) as RealtimeScope,
      );
      if (cancelled) return null;
      if (!result.ok) {
        cached = undefined;
        setConnection("offline");
        return null;
      }
      cached = {
        token: result.token,
        until: Math.min(result.expiresAt - 30000, Date.now() + 45000),
      };
      return result.token;
    });
    const parsed = JSON.parse(scopeKey) as RealtimeScope;
    const filter =
      parsed.audience === "guest"
        ? `id=eq.${parsed.orderId}`
        : `restaurant_id=eq.${parsed.restaurantId}`;
    const channel = client.channel(
      `orders:${parsed.audience}:${crypto.randomUUID()}`,
      {
        config: { postgres_changes_options: { wait: true, timeout: 15000 } },
      },
    );
    const tables =
      parsed.audience === "staff-tables" || parsed.audience === "guest-table"
        ? ["orders", "table_sessions", "bill_requests"]
        : ["orders"];
    for (const table of tables)
      channel
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table, filter },
          () => {
            void refresh.refresh();
          },
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table, filter },
          () => {
            void refresh.refresh();
          },
        );
    channel.subscribe((status) => {
      if (cancelled) return;
      subscribed =
        status === "SUBSCRIBED" && !!cached && cached.until > Date.now();
      setConnection(subscribed ? "live" : "offline");
      if (subscribed) void refresh.refresh();
    });
    const reconcile = () => {
      if (document.visibilityState === "visible") void refresh.refresh();
      else hidePrivate();
    };
    const resume = () => {
      hidePrivate();
      reconcile();
    };
    const online = () => {
      hidePrivate();
      setConnection("connecting");
      cached = undefined;
      void client.realtime
        .setAuth()
        .then(() => {
          if (
            !cancelled &&
            channel.state === "joined" &&
            cached &&
            cached.until > Date.now()
          ) {
            subscribed = true;
            setConnection("live");
          }
        })
        .catch(() => {});
      reconcile();
    };
    const offline = () => {
      hidePrivate();
      subscribed = false;
      setConnection("offline");
    };
    // Safety net for missed events, sleeping tablets and unavailable WebSockets.
    // Closed rows no longer pass guest RLS, including Realtime delivery.
    const timer = setInterval(
      () => {
        if (guest && Date.now() - lastVerified >= 10000) hidePrivate();
        reconcile();
      },
      guest ? 5000 : 30000,
    );
    document.addEventListener("visibilitychange", reconcile);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    window.addEventListener("pagehide", hidePrivate);
    window.addEventListener("pageshow", resume);
    void refresh.refresh();
    return () => {
      cancelled = true;
      cached = undefined;
      refresh.stop();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", reconcile);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("pagehide", hidePrivate);
      window.removeEventListener("pageshow", resume);
      void client.removeChannel(channel);
      client.realtime.disconnect();
    };
    // A different authorized restaurant/order owns a different subscription.
  }, [scopeKey]);
  return {
    value,
    connection,
    error,
    denied,
    privateAvailable,
    refresh: () => refreshRef.current(),
    setValue: (next: T) => setValue((old) => newestSnapshot(old, next)),
  };
}
