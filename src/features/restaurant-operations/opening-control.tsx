"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { setRestaurantOpenAction } from "./actions";

export function OpeningControl({
  restaurantId,
  initialOpen,
  canManage,
  demo = false,
}: {
  restaurantId: string;
  initialOpen: boolean;
  canManage: boolean;
  demo?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(initialOpen),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [message, setMessage] = useState("");
  async function change() {
    if (demo || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await setRestaurantOpenAction(restaurantId, open, !open);
      if (result.ok) {
        setOpen(result.data.isOpen);
        setConfirm(false);
        router.refresh();
      } else {
        setMessage(result.message);
        router.refresh();
      }
    } catch {
      setMessage(
        "The change could not be confirmed. Refresh to check the current status before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="border-b border-line bg-background px-5 py-4 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={`rounded-full px-3 py-1.5 text-[11px] font-semibold tracking-wider ${open ? "bg-accent-soft text-accent" : "bg-stone-200 text-foreground"}`}
          >
            {open ? "OPEN" : "CLOSED"}
          </span>
          <p className="text-xs leading-5 text-muted">
            {open
              ? "Welcoming new visits and orders"
              : "New visits and orders paused · kitchen service continues"}
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            disabled={demo || busy}
            onClick={() => setConfirm(true)}
            className="min-h-11 rounded-full border border-line bg-white px-5 text-xs font-medium text-accent disabled:opacity-50"
          >
            {busy ? "Updating…" : open ? "Close restaurant" : "Open restaurant"}
          </button>
        )}
      </div>
      {confirm && (
        <div className="mt-4 rounded-2xl border border-line bg-white p-4">
          <p className="text-sm font-medium">
            {open
              ? "Close to new guests and orders?"
              : "Open your restaurant for service?"}
          </p>
          <p className="mt-2 text-xs leading-6 text-muted">
            {open
              ? "Existing visits stay active. Staff can finish orders, respond to bill requests and close sessions."
              : "Published menus and active table QR codes will accept new visits and orders."}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              onClick={() => void change()}
              disabled={busy}
              className="min-h-11 rounded-xl bg-accent px-5 text-sm text-white disabled:opacity-50"
            >
              {busy ? "Updating…" : `Confirm ${open ? "CLOSED" : "OPEN"}`}
            </button>
            <button
              disabled={busy}
              onClick={() => setConfirm(false)}
              className="min-h-11 px-4 text-sm text-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {message && (
        <p role="alert" className="mt-3 text-sm text-amber-900">
          {message}
        </p>
      )}
    </div>
  );
}
