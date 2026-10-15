"use client";

import Link from "next/link";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center"
    >
      <h1 className="font-display text-4xl">Something went off menu.</h1>
      <p className="mt-4 text-muted">
        We couldn’t load this page. Please try again.
      </p>
      <button
        onClick={reset}
        className="mt-6 min-h-11 rounded-full bg-accent px-6 py-3 text-white"
      >
        Try again
      </button>
      <Link
        href="/"
        className="mt-4 inline-flex min-h-11 items-center text-sm underline"
      >
        Back to the menu
      </Link>
    </main>
  );
}
