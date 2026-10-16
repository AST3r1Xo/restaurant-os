"use client";
export default function BillError({
  retry,
}: {
  error: Error;
  retry: () => void;
}) {
  return (
    <main id="main-content" className="mx-auto max-w-2xl px-5 py-16">
      <h1 className="font-display text-3xl">
        Your table bill couldn’t be loaded.
      </h1>
      <p className="mt-4 text-sm leading-7 text-muted">
        Reconnect and try again. Please ask staff to confirm the final bill;
        your orders remain recorded.
      </p>
      <button
        onClick={retry}
        className="mt-6 min-h-12 rounded-full bg-accent px-6 text-sm text-white"
      >
        Try again
      </button>
    </main>
  );
}
