"use client";
export default function WorkspaceError({ retry }: { retry: () => void }) {
  return (
    <div role="alert" className="rounded-2xl border border-line bg-white p-7">
      <h1 className="font-display text-3xl">Service couldn’t be loaded.</h1>
      <p className="mt-4 text-sm leading-7 text-muted">
        The restaurant data is temporarily unavailable. Please check your
        connection and try again.
      </p>
      <button
        onClick={retry}
        className="mt-6 min-h-12 rounded-xl bg-accent px-5 text-sm font-medium text-white"
      >
        Try again
      </button>
    </div>
  );
}
