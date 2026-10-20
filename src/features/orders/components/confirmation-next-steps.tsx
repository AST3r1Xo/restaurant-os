import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, ReceiptText } from "lucide-react";
import { customerPath } from "@/lib/routes";

export function ConfirmationNextSteps({
  slug,
  tableToken,
  cancelled,
  menuAvailable,
}: {
  slug: string;
  tableToken?: string;
  cancelled: boolean;
  menuAvailable: boolean;
}) {
  return (
    <div className="mx-auto mt-6 max-w-md">
      {!cancelled && (
        <p className="text-sm leading-6 text-accent">
          Your order is saved with the restaurant. Browsing or ordering more
          won’t change it.
        </p>
      )}
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        {menuAvailable && (
          <Link
            href={customerPath(slug, "menu", tableToken) as Route}
            prefetch={false}
            className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-accent px-4 text-sm font-semibold text-white"
          >
            {cancelled ? "Choose another dish" : "Order more"}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        )}
        <Link
          href={customerPath(slug, "orders", tableToken) as Route}
          prefetch={false}
          className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-2xl border border-line bg-white px-4 text-sm font-medium text-accent"
        >
          <ReceiptText size={16} aria-hidden="true" />
          View sent orders
        </Link>
      </div>
    </div>
  );
}
