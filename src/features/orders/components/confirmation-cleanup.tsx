"use client";

import { useEffect, useMemo } from "react";
import { useCart } from "@/features/cart/components/cart-provider";
import { readStoredSubmission } from "../submission-persistence";

// Refreshing a protected confirmation performs no server mutation. This only
// completes a matching, already confirmed local bag cleanup after navigation.
export function ConfirmationCleanup({ orderId }: { orderId: string }) {
  const { menu, context, ready, clearPurchased } = useCart();
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
  useEffect(() => {
    if (!ready || context.mode !== "live") return;
    try {
      const saved = readStoredSubmission(window.localStorage, scope);
      if (saved?.confirmedOrderId === orderId)
        clearPurchased(orderId, saved.request.items);
    } catch {
      // Order success comes from the protected server snapshot. Storage failure
      // cannot turn a confirmed order into a failure or trigger a new request.
    }
  }, [ready, context.mode, scope, orderId, clearPurchased]);
  return null;
}
