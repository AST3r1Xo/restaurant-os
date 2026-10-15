import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { productPath } from "@/lib/routes";
import { notFound } from "next/navigation";
import { Box, Heart, ArrowUpRight } from "lucide-react";
import { getMenu, getCustomerContext } from "@/features/menu/queries";
import { CustomerShell } from "@/features/menu/components/customer-shell";
import { MenuBrowser } from "@/features/menu/components/menu-browser";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ restaurantSlug: string }>;
}) {
  const menu = await getMenu((await params).restaurantSlug);
  return { title: menu ? `${menu.name} menu` : "Menu not found" };
}

export default async function MenuPage({
  params,
  searchParams,
}: {
  params: Promise<{ restaurantSlug: string }>;
  searchParams: Promise<{ table?: string | string[] }>;
}) {
  const menu = await getMenu((await params).restaurantSlug);
  if (!menu) notFound();
  const token = (await searchParams).table;
  const context = await getCustomerContext(menu.slug, token);
  if (!context) notFound();
  const tableLabel =
    context.table.status === "valid" ? context.table.label : null;
  const preview = menu.products.find((p) => p.visualization);

  return (
    <CustomerShell context={context}>
      <section
        className="grid gap-8 overflow-hidden rounded-3xl bg-[#efeee5] p-7 sm:p-10 lg:grid-cols-[1.1fr_1fr] lg:gap-10 lg:p-12"
        aria-labelledby="welcome-title"
      >
        <div className="flex flex-col justify-center">
          <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
            <span className="h-px w-6 bg-accent" aria-hidden="true" />
            Seasonal. Local. Made with love.
          </p>
          <h1
            id="welcome-title"
            className="mt-6 font-display text-5xl leading-[1.08] tracking-tight sm:text-6xl"
          >
            Good food.
            <br />
            <span className="italic text-accent">Great company.</span>
          </h1>
          <p className="mt-5 max-w-sm text-sm leading-7 text-muted">
            {menu.description ||
              "Welcome to our table. Explore the menu and make yourself at home."}
          </p>
          <div className="mt-8 flex items-center gap-2 text-xs text-accent">
            <Heart size={14} strokeWidth={1.5} aria-hidden="true" />{" "}
            Thoughtfully prepared, made for you.
          </div>
        </div>
        <div className="relative min-h-60 overflow-hidden rounded-2xl lg:min-h-80">
          {menu.coverImage ? (
            <Image
              src={menu.coverImage}
              alt={`${menu.name} restaurant`}
              fill
              priority
              sizes="(max-width: 1023px) 100vw, 480px"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full min-h-60 items-center justify-center bg-accent text-center font-display text-3xl text-background">
              {menu.name}
            </div>
          )}
          <div className="absolute inset-0 bg-linear-to-t from-black/60 via-transparent to-transparent" />
          <p className="absolute bottom-6 left-6 font-display text-2xl italic text-white">
            Make yourself at home.
          </p>
        </div>
      </section>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
        <p>
          {context.mode === "demo" ? "Demo menu" : "Live menu"}{" "}
          <span aria-hidden="true" className="mx-1.5">
            ·
          </span>{" "}
          {context.mode === "demo"
            ? "Try the experience · Real ordering disabled"
            : "Choose your dishes · Review & place your order"}
        </p>
        <span>
          {tableLabel
            ? `${tableLabel}${context.mode === "demo" ? " · Demo table" : " · Verified table"}`
            : "Browse freely · Scan your table QR to order"}
        </span>
      </div>
      <MenuBrowser key={menu.slug} menu={menu} />
      <aside
        className="mt-10 flex flex-col gap-5 rounded-2xl bg-accent-soft p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8"
        aria-labelledby="ar-title"
      >
        <div className="flex items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-accent/15 text-accent">
            <Box size={23} strokeWidth={1.3} aria-hidden="true" />
          </span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
              A fresh perspective
            </p>
            <h2 id="ar-title" className="mt-2 font-display text-2xl">
              Your next bite. In a whole new dimension.
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              {preview?.visualization?.development
                ? "Explore an interactive ingredient study. A development preview of what’s possible."
                : "Explore food from another angle, with optional table placement on supported phones."}
            </p>
          </div>
        </div>
        {preview ? (
          <Link
            prefetch={false}
            href={
              productPath(
                menu.slug,
                preview.id,
                context.table.status === "valid"
                  ? context.table.token
                  : undefined,
              ) as Route
            }
            className="inline-flex min-h-11 shrink-0 items-center gap-2 self-start rounded-full border border-accent/20 px-4 py-2.5 text-xs text-accent sm:self-center"
          >
            Explore in 3D <ArrowUpRight size={13} aria-hidden="true" />
          </Link>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-2 self-start rounded-full border border-accent/20 px-4 py-2.5 text-xs text-accent sm:self-center">
            More perspectives coming soon{" "}
            <ArrowUpRight size={13} aria-hidden="true" />
          </span>
        )}
      </aside>
      <p className="mt-6 text-center text-xs leading-6 text-muted">
        Food allergies or dietary requirements? Please speak with a member of
        our team.
      </p>
    </CustomerShell>
  );
}
