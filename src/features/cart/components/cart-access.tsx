"use client";
import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { ArrowRight, ShoppingBag } from "lucide-react";
import { customerPath } from "@/lib/routes";
import { formatMoney } from "@/lib/format";
import { useCart } from "./cart-provider";
export function CartAccess() {
  const { count, subtotalMinor, lines, menu, context } = useCart();
  const pathname = usePathname();
  if (
    !lines.length ||
    pathname.endsWith("/cart") ||
    pathname.endsWith("/review") ||
    pathname.includes("/orders/") ||
    pathname.includes("/products/")
  )
    return null;
  const token =
    context.table.status === "valid" ? context.table.token : undefined;
  return (
    <div className="cart-dock pointer-events-none fixed inset-x-0 z-30 mx-auto max-w-md px-5">
      <Link
        href={customerPath(menu.slug, "cart", token) as Route}
        prefetch={false}
        className="motion-enter pointer-events-auto flex min-h-14 items-center justify-between gap-4 rounded-2xl bg-accent px-5 py-4 text-white shadow-[0_8px_30px_#314d3b30]"
      >
        <span className="flex items-center gap-3">
          <ShoppingBag size={18} aria-hidden="true" />
          <span className="rounded-md bg-white/15 px-2 py-1 text-xs tabular-nums">
            {count}
          </span>
          <span>
            <span className="block text-sm font-medium">View bag</span>
            <span className="block text-[10px] text-white/80">
              Not sent yet
            </span>
          </span>
        </span>
        <span className="flex items-center gap-2 text-sm font-medium tabular-nums">
          {formatMoney(subtotalMinor, menu.currency)}
          <ArrowRight size={16} aria-hidden="true" />
        </span>
      </Link>
    </div>
  );
}
