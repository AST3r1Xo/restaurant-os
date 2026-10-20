"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  ShoppingBag,
  ClipboardCheck,
  ReceiptText,
  ArrowUpRight,
} from "lucide-react";
import type { Route } from "next";
import clsx from "clsx";
import { customerPath } from "@/lib/routes";
import type { CustomerContext } from "@/features/menu/types";
import { useCart } from "@/features/cart/components/cart-provider";
import { NotificationBell } from "@/features/notifications/components/notification-center";

const items = [
  { key: "menu", label: "Menu", icon: BookOpen },
  { key: "cart", label: "Bag", icon: ShoppingBag },
  { key: "orders", label: "Sent orders", icon: ClipboardCheck },
  { key: "bill", label: "Table bill", icon: ReceiptText },
] as const;

export function CustomerNavigation({ context }: { context: CustomerContext }) {
  const pathname = usePathname();
  const { count } = useCart();
  const { slug, name: restaurantName } = context.restaurant;
  const token =
    context.table.status === "valid" ? context.table.token : undefined;
  const tableLabel =
    context.table.status === "valid" ? context.table.label : null;

  const links = items.map(({ key, label, icon: Icon }) => {
    const href = customerPath(slug, key, token);
    const isActive =
      pathname === href.split("?")[0] ||
      (key === "menu" && pathname.includes("/products/"));
    const active =
      isActive ||
      (key === "orders" && pathname.includes("/orders/")) ||
      (key === "cart" && pathname.endsWith("/review"));
    return (
      <Link
        key={key}
        href={href as Route}
        prefetch={false}
        aria-current={active ? "page" : undefined}
        className={clsx(
          "relative inline-flex min-h-12 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-2 py-1 text-xs sm:px-4 lg:flex-none lg:flex-row lg:gap-2 lg:py-2 lg:text-sm",
          active
            ? "bg-accent-soft font-medium text-accent"
            : "text-muted hover:text-accent",
        )}
      >
        <Icon size={17} strokeWidth={1.6} aria-hidden="true" />
        {label}
        {key === "cart" && count > 0 && (
          <span
            className="absolute top-0 right-0 inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white lg:static"
            aria-label={`${count} dishes in your bag`}
          >
            {count}
          </span>
        )}
      </Link>
    );
  });

  return (
    <>
      <header className="border-b border-line bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-3 sm:px-8 sm:py-5">
          <Link
            href={customerPath(slug, "menu", token) as Route}
            prefetch={false}
            aria-label={`${restaurantName} menu`}
            className="min-w-0"
          >
            {context.restaurant.logoImage ? (
              <span className="inline-flex min-w-0 max-w-full items-center gap-3">
                <Image
                  src={context.restaurant.logoImage}
                  width={40}
                  height={40}
                  alt=""
                  className="size-8 shrink-0 rounded-full object-contain sm:size-10"
                />
                <span className="min-w-0 truncate font-display text-xl sm:max-w-44 sm:text-2xl">
                  {restaurantName}
                </span>
              </span>
            ) : (
              <span className="block truncate font-display text-xl sm:text-3xl">
                {restaurantName}
              </span>
            )}
          </Link>
          <nav
            aria-label="Customer navigation"
            className="hidden items-center gap-1 lg:flex"
          >
            {links}
          </nav>
          <div className="flex max-w-[60%] shrink-0 items-center gap-2">
            <span className="flex min-w-0 items-center gap-2 rounded-full border border-line bg-white/50 px-3 py-2.5 text-xs font-medium">
              <span
                className="size-1.5 rounded-full bg-accent"
                aria-hidden="true"
              />
              {tableLabel ??
                (context.table.status === "invalid"
                  ? "Rescan table QR"
                  : "Browse menu")}
            </span>
            <NotificationBell />
          </div>
        </div>
      </header>
      {context.mode === "demo" && (
        <p className="mx-auto max-w-6xl px-5 pt-4 text-xs text-muted sm:px-8">
          Demo menu · Orders cannot be sent.
        </p>
      )}
      <nav
        aria-label="Mobile customer navigation"
        className="customer-bottom-nav fixed inset-x-0 bottom-0 z-20 flex justify-around border-t border-line bg-background/95 px-2 backdrop-blur-md lg:hidden"
      >
        {links}
      </nav>
    </>
  );
}

export function CustomerFooter() {
  return (
    <footer className="mx-auto mt-12 flex max-w-6xl flex-wrap items-center justify-between gap-4 border-t border-line px-5 pb-28 pt-6 text-xs text-muted sm:px-8 lg:pb-8">
      <span>
        Good food. Thoughtfully connected.{" "}
        <span className="ml-2 font-display text-base text-foreground">
          mesa.
        </span>
      </span>
      <Link
        href="/admin"
        prefetch={false}
        className="inline-flex min-h-11 items-center gap-1.5 hover:text-accent"
      >
        Restaurant workspace <ArrowUpRight size={13} aria-hidden="true" />
      </Link>
    </footer>
  );
}
