"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { setRestaurantOpenAction } from "./actions";
import { ActionButton } from "@/components/action-button";

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
            className={`rounded-full px-3 py-2 text-xs font-semibold ${open ? "bg-accent-soft text-accent" : "bg-danger-soft text-danger"}`}
          >
            {open ? "OPEN" : "CLOSED"}
          </span>
          <p className="text-xs leading-5 text-muted">
            {open
              ? "Customers can place orders"
              : "Ordering is paused. You can finish existing orders."}
          </p>
        </div>
        {canManage && (
          <ActionButton
            type="button"
            disabled={demo || busy}
            onClick={() => open ? setConfirm(true) : void change()}
            tone={open ? "danger" : "confirm"}
          >
            {busy ? "Updating…" : open ? "Close restaurant" : "Open restaurant"}
          </ActionButton>
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
            <ActionButton
              onClick={() => void change()}
              disabled={busy}
              tone={open ? "danger" : "confirm"}
            >
              {busy ? "Updating…" : open ? "Yes, close restaurant" : "Open restaurant"}
            </ActionButton>
            <ActionButton
              disabled={busy}
              onClick={() => setConfirm(false)}
              tone="neutral"
            >
              Keep open
            </ActionButton>
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
