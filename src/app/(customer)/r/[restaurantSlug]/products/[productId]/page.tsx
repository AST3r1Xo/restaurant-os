import { notFound } from "next/navigation";
import { getCustomerContext, getMenu } from "@/features/menu/queries";
import { CustomerShell } from "@/features/menu/components/customer-shell";
import { ProductDetails } from "@/features/products/components/product-details";
import { menuBrowsePath, menuSelection } from "@/features/menu/browse";
import type { BrowseParams } from "@/features/menu/browse";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ restaurantSlug: string; productId: string }>;
}) {
  const { restaurantSlug, productId } = await params;
  const menu = await getMenu(restaurantSlug);
  const product = menu?.products.find((product) => product.id === productId);
  return {
    title:
      menu && !menu.isAcceptingOrders
        ? `${menu.name} · Currently closed`
        : product
          ? `${product.name} · ${menu!.name}`
          : "Dish unavailable",
  };
}
export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ restaurantSlug: string; productId: string }>;
  searchParams: Promise<BrowseParams & { table?: string | string[] }>;
}) {
  const { restaurantSlug, productId } = await params;
  const query = await searchParams;
  const context = await getCustomerContext(
    restaurantSlug,
    query.table,
  );
  if (!context) notFound();
  if (!context.restaurant.isAcceptingOrders)
    return <CustomerShell context={context}>{null}</CustomerShell>;
  const menu = await getMenu(restaurantSlug);
  const product = menu?.products.find((product) => product.id === productId);
  if (!menu || !product) notFound();
  const backToMenu = menuBrowsePath(
    menu.slug,
    context.table.status === "valid" ? context.table.token : undefined,
    menuSelection(menu, query),
    product.id,
  );
  return (
    <CustomerShell context={context}>
      <ProductDetails key={JSON.stringify(product)} product={product} backToMenu={backToMenu} />
    </CustomerShell>
  );
}
