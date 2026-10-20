export default function HistoryLoading() {
  return (
    <div role="status" className="py-6">
      <p className="text-sm text-muted">
        Loading your restaurant’s daily history…
      </p>
      <div
        aria-hidden="true"
        className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {[1, 2, 3, 4].map((n) => (
          <div
            key={n}
            className="h-40 animate-pulse rounded-2xl bg-accent-soft"
          />
        ))}
      </div>
    </div>
  );
}
