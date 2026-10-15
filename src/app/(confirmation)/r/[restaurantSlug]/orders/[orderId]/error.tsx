"use client";

import { useEffect } from "react";
import { ShieldCheck } from "lucide-react";

export default function ConfirmationError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unable to retrieve protected order confirmation.");
  }, []);
  return (
    <main id="main-content" className="mx-auto max-w-2xl px-5 py-16">
      <div className="rounded-3xl border border-line bg-white/60 p-8 text-center">
        <ShieldCheck
          className="mx-auto text-accent"
          size={30}
          aria-hidden="true"
        />
        <h1 className="mt-5 font-display text-3xl">
          We couldn’t open your order.
        </h1>
        <p className="mt-4 text-sm leading-7 text-muted">
          The connection could not be verified. This page does not submit
          another order. Please retry in the browser you used to place it.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-6 text-sm text-white"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
