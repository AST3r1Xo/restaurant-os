import { notFound } from "next/navigation";
import { getCustomerContext, getMenu } from "@/features/menu/queries";
import { CustomerShell } from "@/features/menu/components/customer-shell";
import { ProductDetails } from "@/features/products/components/product-details";
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
  searchParams: Promise<{ table?: string | string[] }>;
}) {
  const { restaurantSlug, productId } = await params;
  const context = await getCustomerContext(
    restaurantSlug,
    (await searchParams).table,
  );
  if (!context) notFound();
  if (!context.restaurant.isAcceptingOrders)
    return <CustomerShell context={context}>{null}</CustomerShell>;
  const menu = await getMenu(restaurantSlug);
  const product = menu?.products.find((product) => product.id === productId);
  if (!product) notFound();
  return (
    <CustomerShell context={context}>
      <ProductDetails key={JSON.stringify(product)} product={product} />
    </CustomerShell>
  );
}
