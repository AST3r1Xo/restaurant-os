import { notFound } from "next/navigation";
import { getMenu, getCustomerContext } from "@/features/menu/queries";
import { CustomerShell } from "@/features/menu/components/customer-shell";
import { MenuBrowser } from "@/features/menu/components/menu-browser";
import { menuSelection } from "@/features/menu/browse";
import type { BrowseParams } from "@/features/menu/browse";

export async function generateMetadata({ params }: {
  params: Promise<{ restaurantSlug: string }>;
}) {
  const menu = await getMenu((await params).restaurantSlug);
  return { title: menu ? `${menu.name} menu` : "Menu not found" };
}

export default async function MenuPage({ params, searchParams }: {
  params: Promise<{ restaurantSlug: string }>;
  searchParams: Promise<BrowseParams & { table?: string | string[] }>;
}) {
  const menu = await getMenu((await params).restaurantSlug);
  if (!menu) notFound();
  const query = await searchParams;
  const context = await getCustomerContext(menu.slug, query.table);
  if (!context) notFound();
  const selection = menuSelection(menu, query);
  return (
    <CustomerShell context={context}>
      <div className="pb-1 pt-5 sm:pt-6">
        <h1 className="font-display text-3xl leading-tight sm:text-4xl">Our menu</h1>
        {context.table.status === "missing" && <p className="mt-2 text-xs leading-5 text-muted">Scan your table’s QR code to place an order.</p>}
      </div>
      <MenuBrowser key={JSON.stringify([menu.slug, selection])} menu={menu} initialSelection={selection} />
      <p className="text-center text-xs leading-6 text-muted">Allergies or dietary requirements? Please speak with our team before ordering.</p>
      {(menu.description || menu.openingHours) && <details className="disclosure mt-4 border-t border-line text-xs text-muted">
        <summary className="font-medium text-accent">About {menu.name}</summary>
        {menu.description && <p className="pb-3 leading-6">{menu.description}</p>}
        {menu.openingHours && <p className="pb-3 whitespace-pre-line leading-6">{menu.openingHours}</p>}
      </details>}
    </CustomerShell>
  );
}
