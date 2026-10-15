"use client";
export default function OrdersError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main-content" className="mx-auto max-w-2xl px-5 py-16">
      <div className="rounded-3xl border border-line bg-white p-8 text-center">
        <h1 className="font-display text-3xl">
          Your orders couldn’t be loaded.
        </h1>
        <p className="mt-4 text-sm leading-7 text-muted">
          Please reconnect and try again in the browser you used to order. This
          screen never places another order or replaces your guest identity.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 min-h-12 rounded-full bg-accent px-6 text-sm text-white"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
