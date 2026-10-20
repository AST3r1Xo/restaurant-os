"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export function RefreshReport() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-busy={pending}
      onClick={() => startTransition(() => router.refresh())}
      className="inline-flex min-h-12 items-center gap-2 rounded-full border border-line bg-white px-5 text-sm font-medium text-accent disabled:opacity-60"
    >
      <RefreshCw size={16} aria-hidden="true" />
      {pending ? "Updating…" : "Refresh day"}
    </button>
  );
}
