// Events invalidate snapshots; they never become trusted UI order records.
// Coalesce bursts and rerun after a request if an event arrived while fetching.
export function newestSnapshot<
  T extends { fetchedAt?: string; updatedAt?: string },
>(current: T, next: T): T {
  const previous = Date.parse(current.fetchedAt ?? current.updatedAt ?? "");
  const incoming = Date.parse(next.fetchedAt ?? next.updatedAt ?? "");
  return Number.isFinite(previous) && incoming < previous ? current : next;
}
export function createReconciler(run: () => Promise<void>) {
  let running = false,
    dirty = false,
    stopped = false;
  return {
    async refresh() {
      if (stopped) return;
      dirty = true;
      if (running) return;
      running = true;
      try {
        while (dirty && !stopped) {
          dirty = false;
          await run();
        }
      } finally {
        running = false;
      }
    },
    stop() {
      stopped = true;
      dirty = false;
    },
  };
}
