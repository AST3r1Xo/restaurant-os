"use client";
import { useEffect } from "react";
import { useRealtimeSnapshot } from "@/features/realtime/use-realtime-snapshot";
import { guestActivityAction } from "../actions";
import type { ActivityContext } from "../repository";
import type { GuestActivity } from "../model";

export type GuestSignalState = {
  value: GuestActivity;
  available: boolean;
  denied: boolean;
};

// This transport is downloaded only after a verified active visit exists.
// It is a sibling of the ordering UI, so loading/reconnecting it cannot
// remount a product form, empty a bag or reset keyboard focus.
export default function GuestActivityTracker({
  initial,
  input,
  onUpdate,
  onRefreshReady,
}: {
  initial: GuestActivity;
  input: ActivityContext;
  onUpdate: (state: GuestSignalState) => void;
  onRefreshReady: (refresh: (() => Promise<void>) | null) => void;
}) {
  const tracking = useRealtimeSnapshot(
    initial,
    {
      audience: "guest-table",
      restaurantSlug: input.slug,
      restaurantId: input.restaurantId,
    },
    () => guestActivityAction(input),
  );
  useEffect(() => {
    onUpdate({
      value: tracking.value,
      available: tracking.privateAvailable,
      denied: tracking.denied,
    });
  }, [onUpdate, tracking.value, tracking.privateAvailable, tracking.denied]);
  useEffect(() => {
    onRefreshReady(tracking.refresh);
    return () => onRefreshReady(null);
  }, [onRefreshReady, tracking.refresh]);
  return null;
}
