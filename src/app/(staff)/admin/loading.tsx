export default function WorkspaceLoading() {
  return (
    <div role="status" className="py-8">
      <p className="text-sm text-muted">Loading your restaurant workspace…</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-40 animate-pulse rounded-2xl bg-accent-soft"
          />
        ))}
      </div>
    </div>
  );
}
