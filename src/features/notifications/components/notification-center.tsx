"use client";
import Link from "next/link";
import type { Route } from "next";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  Bell,
  BellRing,
  Check,
  CheckCheck,
  CircleAlert,
  X,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import type { Notice } from "../model";
import { createNotificationStore } from "../store";
import { actionClass } from "@/components/action-button";

const Context = createContext<{
  store: ReturnType<typeof createNotificationStore>;
  state: ReturnType<ReturnType<typeof createNotificationStore>["getSnapshot"]>;
  available: boolean;
  description: string;
  demo: boolean;
  guest: boolean;
  revoked: boolean;
  refresh?: () => Promise<void>;
} | null>(null);

export function NotificationProvider({
  scope,
  notices,
  available = true,
  description,
  demo = false,
  guest = false,
  revoked = false,
  refresh,
  children,
}: {
  scope: string;
  notices: Notice[];
  available?: boolean;
  description: string;
  demo?: boolean;
  guest?: boolean;
  revoked?: boolean;
  refresh?: () => Promise<void>;
  children: React.ReactNode;
}) {
  // A scope change must not remount the ordering UI beneath this boundary.
  const store = useMemo(() => createNotificationStore(scope), [scope]);
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  useEffect(() => {
    if (revoked) store.revoke();
    else if (!available) store.suspend();
    else store.replace(notices, !demo);
  }, [store, notices, available, revoked, demo]);
  useEffect(() => {
    if (!state.toast) return;
    const timer = setTimeout(() => store.dismissToast(), 8000);
    return () => clearTimeout(timer);
  }, [state.toast, store]);
  return (
    <Context.Provider
      value={{
        store,
        state,
        available,
        description,
        demo,
        guest,
        revoked,
        refresh,
      }}
    >
      {children}
      {available && state.toast && (
        <div
          {...(guest ? { "data-guest-private": true } : {})}
          className="notification-toast pointer-events-none fixed inset-x-0 top-3 z-50 mx-auto max-w-md px-4"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <div
            className={`pointer-events-auto rounded-2xl border-2 bg-white p-4 shadow-xl ${state.toast.tone === "danger" ? "border-danger" : state.toast.tone === "attention" ? "border-attention" : "border-accent"}`}
          >
            <div className="flex items-start gap-3">
              <BellRing
                size={21}
                className="mt-1 shrink-0 text-accent"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="text-base font-bold">{state.toast.title}</p>
                <Link
                  prefetch={false}
                  href={state.toast.href as Route}
                  onClick={() => store.read()}
                  className="mt-1 inline-flex min-h-11 items-center gap-2 font-semibold text-progress underline underline-offset-4"
                >
                  {state.toast.action}
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </div>
              <button
                type="button"
                onClick={() => store.dismissToast()}
                aria-label="Dismiss notification"
                className="-mr-2 -mt-2 flex size-11 shrink-0 items-center justify-center rounded-xl hover:bg-background"
              >
                <X size={19} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      )}
    </Context.Provider>
  );
}

export function NotificationBell() {
  const context = useContext(Context);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const accessAvailable = context?.available;
  useEffect(() => {
    if (accessAvailable === false) dialog.current?.close();
  }, [accessAvailable]);
  // Optional in isolated previews; real customer/staff shells provide scope.
  if (!context) return null;
  const {
    store,
    state,
    available,
    description,
    demo,
    guest,
    revoked,
    refresh,
  } = context;
  const unread = available ? state.unread : 0;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        aria-haspopup="dialog"
        onClick={() => {
          store.read();
          dialog.current?.showModal();
        }}
        className={`relative inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl border-2 px-3 text-sm font-semibold transition-colors ${unread ? "border-attention bg-attention-soft text-attention" : "border-line bg-white text-foreground hover:border-accent"}`}
      >
        <Bell size={20} aria-hidden="true" />
        <span className="hidden sm:inline">Notifications</span>
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="flex min-w-6 items-center justify-center rounded-full bg-danger px-1.5 py-0.5 text-xs font-bold text-white"
          >
            {unread > 30 ? "30+" : unread}
          </span>
        )}
      </button>
      <dialog
        ref={dialog}
        onClose={() => trigger.current?.focus()}
        aria-labelledby={titleId}
        className="notification-dialog fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-3xl border border-line bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/40"
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        <div className="sticky top-0 z-10 border-b border-line bg-background p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2
              id={titleId}
              className="flex items-center gap-2 font-display text-2xl"
            >
              <Bell size={22} aria-hidden="true" />
              Notifications
            </h2>
            <button
              type="button"
              autoFocus
              aria-label="Close notifications"
              onClick={() => dialog.current?.close()}
              className="flex size-12 items-center justify-center rounded-xl border border-line bg-white"
            >
              <X size={21} aria-hidden="true" />
            </button>
          </div>
          <p className="mt-3 text-sm leading-6 text-muted">{description}</p>
          {unread > 0 && (
            <p
              role="status"
              aria-live="polite"
              className="mt-3 rounded-xl bg-attention-soft px-3 py-2 text-sm font-bold text-attention"
            >
              {unread} new {unread === 1 ? "update" : "updates"}
            </p>
          )}
          {refresh && !demo && (
            <button
              type="button"
              onClick={() => void refresh()}
              className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-semibold text-progress underline underline-offset-4"
            >
              <RefreshCw size={16} aria-hidden="true" />
              Check for updates
            </button>
          )}
          {demo && (
            <p className="mt-2 text-sm font-semibold text-attention">
              Demo preview · sample information
            </p>
          )}
        </div>
        <div {...(guest ? { "data-guest-private": true } : {})}>
          {available && state.notices.length ? (
            <ul className="space-y-3 p-4 sm:p-5">
              {state.notices.map((notice) => {
                const Icon =
                  notice.tone === "danger"
                    ? CircleAlert
                    : notice.tone === "attention"
                      ? BellRing
                      : Check;
                return (
                  <li
                    key={notice.id}
                    className={`rounded-2xl border-l-4 bg-white p-4 ${notice.tone === "danger" ? "border-danger" : notice.tone === "attention" ? "border-attention" : "border-accent"}`}
                  >
                    <div className="flex items-start gap-3">
                      <Icon
                        size={20}
                        className={`mt-0.5 shrink-0 ${notice.tone === "danger" ? "text-danger" : notice.tone === "attention" ? "text-attention" : "text-accent"}`}
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <h3 className="text-base font-bold">{notice.title}</h3>
                        <p className="mt-2 text-sm leading-6 text-muted">
                          {notice.message}
                        </p>
                      </div>
                    </div>
                    <Link
                      prefetch={false}
                      href={notice.href as Route}
                      onClick={() => {
                        store.read();
                        dialog.current?.close();
                      }}
                      className={actionClass(
                        notice.tone === "danger" ? "danger" : "progress",
                        "mt-4 w-full",
                      )}
                    >
                      {notice.action}
                      <ArrowRight size={16} aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-6 py-12 text-center">
              <CheckCheck
                size={30}
                className="mx-auto text-accent"
                aria-hidden="true"
              />
              <p className="mt-4 text-base font-semibold">
                {revoked
                  ? "Visit updates unavailable"
                  : available
                    ? "You’re all caught up"
                    : "Checking live updates"}
              </p>
              <p className="mt-3 text-sm leading-6 text-muted">
                {guest
                  ? "Updates belong only to your current visit. Keep this page open to receive them."
                  : "New orders and bill requests will appear here while the workspace is open."}
              </p>
            </div>
          )}
        </div>
      </dialog>
    </>
  );
}
