import { notFound } from "next/navigation";
import { getCustomerContext } from "@/features/menu/queries";
import { CustomerShell } from "@/features/menu/components/customer-shell";
import { CartPageContent } from "@/features/cart/components/cart-page";
export const metadata = { title: "Your bag" };
export default async function CartPage({
  params,
  searchParams,
}: {
  params: Promise<{ restaurantSlug: string }>;
  searchParams: Promise<{ table?: string | string[] }>;
}) {
  const context = await getCustomerContext(
    (await params).restaurantSlug,
    (await searchParams).table,
  );
  if (!context) notFound();
  return (
    <CustomerShell context={context}>
      <CartPageContent />
    </CustomerShell>
  );
}
