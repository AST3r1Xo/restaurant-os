"use client";
import { useState } from "react";
import { BellRing, Users, Check, Clock3, ArrowRight } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { manageSessionAction, tableWorkspaceAction } from "../actions";
import { useTableOperations } from "./table-operations-provider";
import { SessionOrderList } from "./session-order-list";
import type { SessionSummary } from "../types";
import { ActionButton } from "@/components/action-button";
export function TablesWorkspace() {
  const { value, demo, isOpen, connection, error, refresh, setValue } =
    useTableOperations();
  const [busy, setBusy] = useState<string>(),
    [message, setMessage] = useState<string>(),
    [selected, setSelected] = useState<SessionSummary>(),
    [confirmClose, setConfirmClose] = useState<string>(),
    [older, setOlder] = useState<SessionSummary[]>([]),
    [cursor, setCursor] = useState<string | null | undefined>(),
    [loadingOlder, setLoadingOlder] = useState(false);
  const sessions = [
    ...new Map(
      [
        ...older,
        ...value.history,
        ...value.tables.flatMap((t) => (t.session ? [t.session] : [])),
      ].map((s) => [s.id, s]),
    ).values(),
  ];
  const selection = selected
    ? (sessions.find((s) => s.id === selected.id) ?? selected)
    : undefined;
  async function manage(
    tableId: string,
    operation: "open" | "close" | "acknowledge",
    sessionId?: string,
  ) {
    if (busy || demo) return;
    setBusy(tableId);
    setMessage(undefined);
    try {
      const result = await manageSessionAction({
        restaurantId: value.restaurantId,
        tableId,
        operation,
        ...(sessionId ? { sessionId } : {}),
      });
      if (result.ok) {
        setValue(result.value);
        setConfirmClose(undefined);
      } else {
        setMessage(result.message);
        void refresh();
      }
    } catch {
      setMessage(
        "The response was interrupted. Refresh to check the session before retrying; operations are safe to repeat.",
      );
      void refresh();
    } finally {
      setBusy(undefined);
    }
  }
  async function more() {
    const next = cursor === undefined ? value.nextCursor : cursor;
    if (!next || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const result = await tableWorkspaceAction(value.restaurantId, next);
      if (result.ok) {
        setOlder((old) => [
          ...new Map(
            [...old, ...result.value.history].map((s) => [s.id, s]),
          ).values(),
        ]);
        setCursor(result.value.nextCursor);
      } else setMessage(result.message);
    } catch {
      setMessage("Older sessions could not be loaded. Please retry.");
    } finally {
      setLoadingOlder(false);
    }
  }
  const history = [
    ...new Map([...older, ...value.history].map((s) => [s.id, s])).values(),
  ].sort(
    (a, b) => b.openedAt.localeCompare(a.openedAt) || b.id.localeCompare(a.id),
  );
  return (
    <div className="motion-enter">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl sm:text-5xl">Tables</h1>
          <p className="mt-3 text-sm text-muted">
            {value.tables.filter((t) => t.session).length} occupied ·{" "}
            {value.requests.length} bill requests
          </p>
        </div>
        {(connection !== "live" || error || message) && !demo ? <ActionButton
          onClick={() => void refresh()}
          disabled={demo}
          tone="neutral"
        >
          Reconnect
        </ActionButton> : <span className="text-xs text-muted">{demo ? "Sample tables" : "Updates automatically"}</span>}
      </div>
      {(message || error) && (
        <p
          role="alert"
          className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"
        >
          {message ?? error}
        </p>
      )}
      {value.requests.length > 0 && (
        <section
          id="bill-requests"
          aria-label="Pending bill requests"
          className="mt-7 rounded-3xl border border-attention/20 bg-attention-soft p-5 sm:p-7"
        >
          <h2 className="flex items-center gap-3 text-xl font-bold text-attention">
            <BellRing size={18} aria-hidden="true" />
            Bring the bill
          </h2>
          <ul className="mt-4 divide-y divide-accent/10">
            {value.requests.map((r) => (
              <li
                key={r.id}
                data-request-id={r.id}
                className="flex flex-wrap items-center justify-between gap-4 py-3"
              >
                <div>
                  <p className="text-base font-bold">
                    {r.tableLabel} has requested the bill.
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {new Intl.DateTimeFormat("en-GB", {
                      timeZone: value.timezone,
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(r.requestedAt))}{" "}
                    · This visit
                  </p>
                </div>
                <ActionButton
                  onClick={() =>
                    void manage(r.tableId, "acknowledge", r.sessionId)
                  }
                  disabled={!!busy || demo}
                  tone="progress"
                >
                  <Check size={17} aria-hidden="true" />
                  I’ll bring the bill
                </ActionButton>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section
        aria-label="Current tables"
        className="mt-7 grid gap-5 md:grid-cols-2 xl:grid-cols-3"
      >
        {value.tables.map((t) => {
          const s = t.session;
          return (
            <article
              key={t.id}
              data-table-id={t.id}
              data-session-id={s?.id}
              className="rounded-3xl border border-line bg-white p-5 sm:p-6"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-2xl">{t.label}</h2>
                <span
                  className={`rounded-full px-3 py-1.5 text-[10px] font-medium ${s ? "bg-accent-soft text-accent" : "bg-background text-muted"}`}
                >
                  {s
                    ? "Occupied"
                    : t.isActive
                      ? "Available"
                      : "Inactive table"}
                </span>
              </div>
              {s ? (
                <>
                  <p className="mt-5 flex items-center gap-2 text-xs text-muted">
                    <Users size={15} aria-hidden="true" />
                    {s.totals.orderCount} orders this visit
                  </p>
                  <p className="mt-3 font-display text-4xl tabular-nums text-accent">
                    {formatMoney(s.totals.orderValueMinor, s.currency)}
                  </p>
                  <p className="mt-2 text-xs leading-6 text-muted">
                    Accepted {formatMoney(s.totals.confirmedMinor, s.currency)}{" "}
                    · Pending {formatMoney(s.totals.pendingMinor, s.currency)}
                    <br />
                    Recorded order value · cancelled excluded
                  </p>
                  {s.request && (
                    <p className="mt-4 rounded-xl bg-accent-soft p-3 text-xs leading-5 text-accent">
                      {s.request.status === "requested"
                        ? "Bill requested — awaiting staff"
                        : "Bill request acknowledged"}
                    </p>
                  )}
                  <ActionButton
                    onClick={() => setSelected(s)}
                    disabled={demo}
                    tone="progress"
                    className="mt-4 w-full"
                  >
                    View orders & bill
                    <ArrowRight size={16} aria-hidden="true" />
                  </ActionButton>
                  {confirmClose === s.id ? (
                    <div className="mt-4 rounded-xl border border-line bg-background p-4">
                      <p className="text-xs leading-6 text-muted">
                        End this visit? Customers will lose access to these
                        orders. Records stay saved for staff. This does not record payment.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <ActionButton
                          onClick={() => void manage(t.id, "close", s.id)}
                          disabled={!!busy || demo}
                          tone="danger"
                        >
                          Yes, end visit
                        </ActionButton>
                        <button
                          onClick={() => setConfirmClose(undefined)}
                          className="min-h-12 px-4 text-xs text-muted"
                        >
                          Keep open
                        </button>
                      </div>
                    </div>
                  ) : (
                    <ActionButton
                      onClick={() => setConfirmClose(s.id)}
                      disabled={
                        demo ||
                        !!busy ||
                        s.totals.unfinishedCount > 0 ||
                        s.request?.status === "requested"
                      }
                      tone="danger"
                      className="mt-3 w-full"
                    >
                      End visit
                    </ActionButton>
                  )}
                  {(s.totals.unfinishedCount > 0 ||
                    s.request?.status === "requested") && (
                      <p className="mt-2 text-[11px] leading-5 text-muted">
                        {s.totals.unfinishedCount > 0 ? "Finish the remaining orders before ending this visit." : "Respond to the bill request before ending this visit."}
                      </p>
                    )}
                </>
              ) : (
                <>
                  <p className="mt-6 text-sm leading-7 text-muted">
                    {isOpen
                      ? "Ready for guests. A visit starts with their first order, or you can start one here."
                      : "The restaurant is CLOSED. An owner or manager must open service before starting a new visit."}
                  </p>
                  <ActionButton
                    onClick={() => void manage(t.id, "open")}
                    disabled={demo || !!busy || !t.isActive || !isOpen}
                    tone="neutral"
                    className="mt-6 w-full"
                  >
                    Start visit
                  </ActionButton>
                </>
              )}
            </article>
          );
        })}
      </section>
      {!value.tables.length && (
        <p className="mt-7 rounded-2xl border border-line bg-white p-7 text-sm text-muted">
          No tables have been provisioned for this restaurant. Use trusted
          administration to add tables.
        </p>
      )}
      {selection && !demo && (
        <div>
          <div className="mt-6 flex justify-end">
            <button
              onClick={() => setSelected(undefined)}
              className="min-h-11 px-3 text-xs text-accent"
            >
              Close order details
            </button>
          </div>
          <SessionOrderList
            key={selection.id}
            restaurantId={value.restaurantId}
            session={selection}
          />
        </div>
      )}
      <details className="disclosure mt-10 rounded-2xl border border-line bg-white p-5">
        <summary className="text-base font-semibold">
          <span className="flex items-center gap-3">
            <Clock3 size={20} strokeWidth={1.5} aria-hidden="true" />
            Previous visits
          </span>
        </summary>
        <section aria-label="Historical dining sessions">
          <p className="mt-3 text-xs leading-6 text-muted">
            Closed sessions retain their recorded orders. No payment status is
            recorded or inferred.
          </p>
          {!history.length ? (
            <p className="mt-5 rounded-2xl border border-line bg-white p-6 text-sm text-muted">
              Completed visits will appear here.
            </p>
          ) : (
            <div className="mt-5 divide-y divide-line rounded-2xl border border-line bg-white px-5">
              {history.map((s) => (
                <div
                  key={s.id}
                  data-history-session={s.id}
                  className="flex flex-wrap items-center justify-between gap-4 py-4"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {s.tableLabel} · Closed session
                    </p>
                    <p className="mt-2 text-xs text-muted">
                      {new Intl.DateTimeFormat("en-GB", {
                        timeZone: value.timezone,
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(s.openedAt))}{" "}
                      · {s.totals.orderCount} orders
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-display text-2xl tabular-nums text-accent">
                      {formatMoney(s.totals.orderValueMinor, s.currency)}
                    </span>
                    <button
                      onClick={() => setSelected(s)}
                      disabled={demo}
                      className="min-h-12 rounded-full border border-line px-4 text-xs text-accent"
                    >
                      View orders
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {(cursor === undefined ? value.nextCursor : cursor) && (
            <button
              onClick={() => void more()}
              disabled={loadingOlder || demo}
              className="mt-5 min-h-12 rounded-full border border-line bg-white px-5 text-sm text-accent"
            >
              {loadingOlder ? "Loading…" : "Show older sessions"}
            </button>
          )}
        </section>
      </details>
    </div>
  );
}
