"use client";
import { useState } from "react";
import Link from "next/link";
import { LoaderCircle, ArrowRight } from "lucide-react";
import { Brand } from "@/components/brand";
import { loginStaffAction, signOutStaffAction } from "../actions";
export function StaffLogin({
  message,
  hasSession = false,
}: {
  message?: string;
  hasSession?: boolean;
}) {
  const [error, setError] = useState(message);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    const form = new FormData(e.currentTarget);
    try {
      const result = await loginStaffAction({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      });
      if (!result.ok) setError(result.message);
    } catch {
      setError("We couldn’t reach the restaurant workspace. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12"
    >
      <Brand />
      <p className="mt-10 text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
        Restaurant team
      </p>
      <h1 className="mt-3 font-display text-4xl">A calm place for service.</h1>
      <p className="mt-4 text-sm leading-7 text-muted">
        Sign in with the account provided by your restaurant owner.
      </p>
      <form onSubmit={(e) => void submit(e)} className="mt-8 space-y-5">
        <div>
          <label htmlFor="staff-email" className="text-sm font-medium">
            Email address
          </label>
          <input
            id="staff-email"
            name="email"
            type="email"
            autoComplete="username"
            required
            maxLength={254}
            className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-4"
          />
        </div>
        <div>
          <label htmlFor="staff-password" className="text-sm font-medium">
            Password
          </label>
          <input
            id="staff-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={256}
            className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-4"
          />
        </div>
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"
          >
            {error}
          </p>
        )}
        <button
          disabled={busy}
          className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-white disabled:opacity-60"
        >
          {busy ? (
            <LoaderCircle
              size={17}
              className="animate-spin"
              aria-hidden="true"
            />
          ) : (
            <ArrowRight size={17} aria-hidden="true" />
          )}
          {busy ? "Signing in…" : "Sign in to workspace"}
        </button>
      </form>
      {hasSession && (
        <form action={signOutStaffAction}>
          <button className="mt-3 min-h-11 w-full text-sm text-accent underline">
            Sign out of this account
          </button>
        </form>
      )}
      <p className="mt-6 text-xs leading-6 text-muted">
        Need access or help with your password? Speak to your restaurant owner.
        Employee accounts are provisioned through trusted administration.
      </p>
      <Link
        href="/"
        className="mt-5 inline-flex min-h-11 items-center text-sm text-accent"
      >
        Back to customer menu
      </Link>
    </main>
  );
}
