"use client";
import Link from "next/link";
import { createContext, useContext } from "react";
import { BellRing } from "lucide-react";
import { useRealtimeSnapshot } from "@/features/realtime/use-realtime-snapshot";
import { tableWorkspaceAction } from "../actions";
import type { TableWorkspace } from "../types";
import { actionClass } from "@/components/action-button";
type Operations = {
  value: TableWorkspace;
  demo: boolean;
  isOpen: boolean;
  connection: string;
  error?: string;
  refresh: () => Promise<void>;
  setValue: (v: TableWorkspace) => void;
};
const Context = createContext<Operations | null>(null);
export function useTableOperations() {
  const context = useContext(Context);
  if (!context) throw new Error("Table operations provider is required");
  return context;
}
function LiveProvider({
  initial,
  isOpen,
  children,
}: {
  initial: TableWorkspace;
  isOpen: boolean;
  children: React.ReactNode;
}) {
  const realtime = useRealtimeSnapshot(
    initial,
    { audience: "staff-tables", restaurantId: initial.restaurantId },
    () => tableWorkspaceAction(initial.restaurantId),
  );
  if (realtime.denied)
    return (
      <main id="main-content" className="mx-auto max-w-2xl px-5 py-16">
        <h1 className="font-display text-3xl">
          Restaurant access has changed.
        </h1>
        <p role="alert" className="mt-5 text-sm leading-7 text-muted">
          {realtime.error}
        </p>
        <Link
          href="/admin/login"
          className="mt-6 inline-flex min-h-12 items-center rounded-full bg-accent px-6 text-sm text-white"
        >
          Sign in to the workspace
        </Link>
      </main>
    );
  return (
    <Context.Provider value={{ ...realtime, demo: false, isOpen }}>
      {children}
    </Context.Provider>
  );
}
export function TableOperationsProvider({
  initial,
  demo,
  isOpen = true,
  children,
}: {
  initial: TableWorkspace;
  demo: boolean;
  isOpen?: boolean;
  children: React.ReactNode;
}) {
  if (!demo)
    return (
      <LiveProvider
        key={initial.restaurantId}
        initial={initial}
        isOpen={isOpen}
      >
        {children}
      </LiveProvider>
    );
  return (
    <Context.Provider
      value={{
        value: initial,
        demo: true,
        isOpen,
        connection: "demo",
        refresh: async () => { },
        setValue: () => { },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function StaffBillInbox() {
  const { value, demo, connection, error } = useTableOperations();
  if (demo || (!value.requests.length && connection === "live" && !error)) return null;
  return (
    <div className="border-b-2 border-attention/25 bg-attention-soft px-5 py-4 sm:px-8">
      {value.requests.length ? (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm"
        >
          <p className="flex items-start gap-3 text-base font-bold text-attention">
            <BellRing
              size={23}
              className="mt-0.5 shrink-0"
              aria-hidden="true"
            />
            {value.requests.length === 1
              ? `${value.requests[0].tableLabel} has requested the bill.`
              : `${value.requests.length} tables have requested the bill.`}
          </p>
          <Link
            href="/admin/tables#bill-requests"
            className={actionClass("attention")}
          >
            View bill requests
          </Link>
        </div>
      ) : null}
      {(connection !== "live" || error) && (
        <p role="status" className="mt-1 text-[11px] leading-5 text-amber-800">
          {error ?? "Reconnecting to table service updates…"}
        </p>
      )}
    </div>
  );
}
