import type { Notice } from "./model.ts";
import { sortNotices } from "./model.ts";

// Read markers only, never private payloads, credentials or localStorage.
// They survive route changes in this tab; a reload starts a fresh inbox.
const markers = new Map<string, { seen: Set<string>; read: Set<string> }>();
function memory(scope: string) {
  let saved = markers.get(scope);
  if (!saved) {
    saved = { seen: new Set(), read: new Set() };
    markers.set(scope, saved);
    if (markers.size > 8) markers.delete(markers.keys().next().value!);
  }
  return saved;
}
export type NotificationState = {
  notices: Notice[];
  unread: number;
  toast: Notice | null;
};
const empty: NotificationState = { notices: [], unread: 0, toast: null };
export function createNotificationStore(scope: string) {
  let state = empty,
    initialized = false;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    getServerSnapshot: () => empty,
    replace(notices: Notice[], live = true) {
      const saved = memory(scope),
        current = sortNotices(notices);
      const arrivals = current.filter((n) => !saved.seen.has(n.id));
      for (const notice of current) saved.seen.add(notice.id);
      // Keep marker memory bounded even on a long-running kitchen tablet.
      if (saved.seen.size > 256)
        saved.seen = new Set([...saved.seen].slice(-128));
      if (saved.read.size > 256)
        saved.read = new Set([...saved.read].slice(-128));
      const toast =
        initialized && live && arrivals.length
          ? arrivals[0]
          : current.some((n) => n.id === state.toast?.id)
            ? state.toast
            : null;
      state = {
        notices: current,
        unread: current.filter((n) => !saved.read.has(n.id)).length,
        toast,
      };
      initialized = true;
      emit();
    },
    read() {
      const saved = memory(scope);
      for (const notice of state.notices) saved.read.add(notice.id);
      state = { ...state, unread: 0, toast: null };
      emit();
    },
    dismissToast() {
      if (state.toast) {
        state = { ...state, toast: null };
        emit();
      }
    },
    suspend() {
      state = empty;
      emit();
    },
    revoke() {
      markers.delete(scope);
      initialized = false;
      state = empty;
      emit();
    },
  };
}
