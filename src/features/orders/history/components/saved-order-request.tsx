"use client";
import { useSyncExternalStore } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useCart } from "@/features/cart/components/cart-provider";
import { customerPath } from "@/lib/routes";
import {
  parseStoredSubmission,
  submissionStorageKey,
} from "../../submission-persistence";

// Retain recovery for an uncertain submission; local storage never grants access
// to history and is never a source of order totals or proof of success.
export function SavedOrderRequest() {
  const { menu, context } = useCart();
  const scope = {
    restaurantId: menu.id,
    mode: context.mode,
    currency: menu.currency,
    visitKey:
      context.table.status === "valid" ? context.table.visitKey : undefined,
  };
  const key = submissionStorageKey(scope);
  const subscribe = (listener: () => void) => {
    const changed = (e: StorageEvent) => {
      if (e.key === null || e.key === key) listener();
    };
    window.addEventListener("storage", changed);
    window.addEventListener("focus", listener);
    return () => {
      window.removeEventListener("storage", changed);
      window.removeEventListener("focus", listener);
    };
  };
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    () => null,
  );
  const saved = parseStoredSubmission(raw, scope);
  if (context.mode !== "live" || !saved || saved.confirmedOrderId) return null;
  const token =
    context.table.status === "valid" ? context.table.token : undefined;
  return (
    <p
      role="status"
      className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-xs leading-6 text-amber-900"
    >
      A saved order request still needs a confirmed result.{" "}
      <Link
        href={customerPath(menu.slug, "review", token) as Route}
        prefetch={false}
        className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
      >
        Check saved request safely
      </Link>
    </p>
  );
}
