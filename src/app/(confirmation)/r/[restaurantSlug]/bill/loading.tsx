export default function BillLoading() {
  return (
    <main
      id="main-content"
      aria-busy="true"
      className="mx-auto max-w-3xl px-5 py-16"
    >
      <p role="status" className="text-sm text-muted">
        Opening your table session…
      </p>
      <div
        aria-hidden="true"
        className="mt-6 h-80 rounded-3xl bg-accent-soft"
      />
    </main>
  );
}
