export default function OrdersLoading() {
  return (
    <main
      id="main-content"
      className="mx-auto max-w-5xl px-5 py-16"
      aria-busy="true"
    >
      <p role="status" className="text-sm text-muted">
        Opening your private orders…
      </p>
      <div
        className="mt-6 grid gap-6 md:grid-cols-[1.5fr_1fr]"
        aria-hidden="true"
      >
        <div className="h-72 rounded-3xl bg-accent-soft" />
        <div className="h-60 rounded-3xl bg-accent-soft" />
      </div>
    </main>
  );
}
