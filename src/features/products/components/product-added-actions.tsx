import Link from "next/link";
import type { Route } from "next";
import { Check, ArrowRight } from "lucide-react";

export function ProductAddedActions({
  menuHref,
  bagHref,
  saved,
}: {
  menuHref: string;
  bagHref: string;
  saved: boolean;
}) {
  return (
    <div className="w-full">
      <p
        role="status"
        className="flex items-center justify-center gap-2 text-sm font-semibold text-accent"
      >
        <Check size={17} aria-hidden="true" /> Added to your bag
      </p>
      <p className="mt-1 text-center text-xs leading-5 text-muted">
        {saved
          ? "Not sent yet. Your bag stays saved while you browse."
          : "Your browser couldn’t save your bag. Keep this page open and allow storage before continuing."}
      </p>
      {saved && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Link
            href={menuHref as Route}
            prefetch={false}
            className="flex min-h-14 items-center justify-center rounded-2xl border border-line bg-white px-3 text-center text-sm font-medium text-accent"
          >
            Add more dishes
          </Link>
          <Link
            href={bagHref as Route}
            prefetch={false}
            className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-accent px-3 text-center text-sm font-medium text-white"
          >
            View bag <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      )}
    </div>
  );
}
