"use client";
export default function HistoryError({ retry }: { retry: () => void }) {
  return (
    <div role="alert" className="rounded-2xl border border-line bg-white p-7">
      <h1 className="font-display text-3xl">History couldn’t be loaded.</h1>
      <p className="mt-4 max-w-xl text-sm leading-7 text-muted">
        Check your connection and try again. If your restaurant access changed,
        sign in again and select the correct restaurant.
      </p>
      <button
        type="button"
        onClick={retry}
        className="mt-6 min-h-12 rounded-full bg-accent px-5 text-sm font-medium text-white"
      >
        Try again
      </button>
    </div>
  );
}
