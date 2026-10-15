import { notFound } from "next/navigation";
import { getCustomerContext } from "@/features/menu/queries";
import { CustomerShell } from "@/features/menu/components/customer-shell";
import { OrderReviewContent } from "@/features/orders/components/order-review";

export const metadata = { title: "Review Order" };
export default async function ReviewPage({
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
      <OrderReviewContent />
    </CustomerShell>
  );
}
