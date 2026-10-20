"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import {
  ClipboardList,
  BookOpen,
  Grid2X2,
  Settings,
  ArrowUpRight,
  ChartNoAxesCombined,
} from "lucide-react";
import { Brand } from "@/components/brand";
import type { StaffRestaurant } from "@/features/staff/types";

const items = [
  { href: "/admin", label: "Orders", icon: ClipboardList },
  { href: "/admin/tables", label: "Tables", icon: Grid2X2 },
  { href: "/admin/history", label: "Daily history", icon: ChartNoAxesCombined },
  { href: "/admin/menu", label: "Edit menu", icon: BookOpen },
  { href: "/admin/settings", label: "Restaurant settings", icon: Settings },
] as const;

export function AdminNavigation({
  restaurant,
  demo,
}: {
  restaurant: StaffRestaurant;
  demo: boolean;
}) {
  const pathname = usePathname();
  return (
    <aside className="border-b border-line bg-white/60 lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-60 lg:flex-col lg:border-r lg:border-b-0">
      <div className="flex items-center justify-between px-6 py-6 lg:block">
        <Link href="/admin" aria-label="Restaurant orders">
          <Brand />
        </Link>
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted lg:mt-3">
          Staff area
        </p>
      </div>
      <nav
        aria-label="Staff navigation"
        className="flex gap-1 overflow-x-auto px-3 pb-4 lg:flex-col lg:gap-2 lg:px-4"
      >
        {items
          .filter(
            (item) =>
              restaurant.role !== "staff" ||
              !["/admin/menu", "/admin/settings", "/admin/history"].includes(item.href),
          )
          .map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href || (href === "/admin" && pathname === "/admin/orders") ? "page" : undefined}
              className={clsx(
                "flex min-h-11 items-center gap-3 rounded-xl px-4 py-3 text-sm",
                pathname === href || (href === "/admin" && pathname === "/admin/orders")
                  ? "bg-accent-soft font-medium text-accent"
                  : "text-muted hover:bg-background hover:text-accent",
              )}
            >
              <Icon size={18} strokeWidth={1.6} aria-hidden="true" />
              {label}
            </Link>
          ))}
      </nav>
      <div className="hidden px-6 pb-6 lg:mt-auto lg:block">
        <p className="text-sm font-medium">{restaurant.name}</p>
        <p className="mt-1 text-xs text-muted">
          {demo ? "Demo restaurant" : "Live restaurant"}
        </p>
        <Link
          href={`/r/${restaurant.slug}`}
          className="mt-4 inline-flex min-h-11 items-center gap-2 text-xs text-accent"
        >
          Open customer menu <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </aside>
  );
}
