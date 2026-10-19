import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { productPath } from "@/lib/routes";
import { notFound } from "next/navigation";
import { Box, ArrowUpRight } from "lucide-react";
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
        className="mt-4 grid gap-5 overflow-hidden rounded-3xl bg-[#efeee5] p-5 sm:mt-5 sm:p-8 lg:grid-cols-[1.1fr_1fr] lg:gap-8"
        aria-labelledby="welcome-title"
      >
        <div className="flex flex-col justify-center">
          <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
            <span className="h-px w-6 bg-accent" aria-hidden="true" />
            {tableLabel ? `Welcome to ${tableLabel}` : `Welcome to ${menu.name}`}
          </p>
          <h1
            id="welcome-title"
            className="mt-2 font-display text-2xl leading-tight sm:mt-3 sm:text-4xl"
          >
            What would you like?
          </h1>
          <p className="mt-2 line-clamp-2 max-w-sm text-sm leading-6 text-muted sm:mt-5 sm:line-clamp-none sm:leading-7">
            {menu.description ||
              "Welcome to our table. Explore the menu and make yourself at home."}
          </p>
        </div>
        <div className="relative hidden min-h-44 overflow-hidden rounded-2xl sm:block lg:min-h-52">
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
        </div>
      </section>
      {!tableLabel && <p className="mt-4 text-sm text-muted">Scan the QR code at your table when you’re ready to order.</p>}
      <MenuBrowser key={menu.slug} menu={menu} />
      {preview && <aside
        className="mt-8 flex flex-col gap-4 rounded-2xl bg-accent-soft p-5 sm:flex-row sm:items-center sm:justify-between"
        aria-labelledby="ar-title"
      >
        <div className="flex items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-accent/15 text-accent">
            <Box size={23} strokeWidth={1.3} aria-hidden="true" />
          </span>
          <div>
            <h2 id="ar-title" className="mt-2 font-display text-2xl">
              Take a closer look in 3D
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              {preview.visualization?.development || preview.visualization?.demonstration
                ? "Try a clearly labelled 3D demonstration. It does not show a verified portion size."
                : "Rotate and explore the dish before ordering."}
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
      </aside>}
      <p className="mt-6 text-center text-xs leading-6 text-muted">
        Food allergies or dietary requirements? Please speak with a member of
        our team.
      </p>
    </CustomerShell>
  );
}
