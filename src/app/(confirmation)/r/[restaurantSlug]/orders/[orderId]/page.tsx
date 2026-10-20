import { notFound } from "next/navigation";
import { getCustomerContext, getMenu } from "@/features/menu/queries";
import type { CustomerContext, RestaurantMenu } from "@/features/menu/types";
import { getConfirmedOrder } from "@/features/orders/queries";
import { CustomerShell } from "@/features/menu/components/customer-shell";
import { OrderConfirmation } from "@/features/orders/components/order-confirmation";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Order Confirmed",
  robots: { index: false, follow: false },
};
export default async function ConfirmedOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ restaurantSlug: string; orderId: string }>;
  searchParams: Promise<{ table?: string | string[] }>;
}) {
  const { restaurantSlug, orderId } = await params;
  // Authorize the private snapshot first. Publication or possession of a table
  // QR never decides whether a guest may read an already confirmed order.
  const order = await getConfirmedOrder(restaurantSlug, orderId);
  if (!order) notFound();
  let publicContext: CustomerContext | null = null;
  let menu: RestaurantMenu | null = null;
  let menuLoadFailed = false;
  try {
    [menu, publicContext] = await Promise.all([
      getMenu(restaurantSlug),
      getCustomerContext(restaurantSlug, (await searchParams).table),
    ]);
  } catch {
    menuLoadFailed = true;
  }
  // This is an owned-order shell, not demo data or a fallback menu. Empty
  // catalog data preserves local intents and prevents unavailable additions.
  const ownedMenu: RestaurantMenu = menu ?? {
    ...order.restaurant,
    currency: order.currency,
    isAcceptingOrders: false,
    categories: [],
    products: [],
  };
  const context: CustomerContext = publicContext ?? {
    mode: "live",
    restaurant: ownedMenu,
    table: { status: "missing" },
  };
  const token =
    context.table.status === "valid" ? context.table.token : undefined;
  return (
    <CustomerShell context={context} menuOverride={ownedMenu} visitOnly>
      <OrderConfirmation
        order={order}
        tableToken={token}
        menuAvailable={!!menu}
        menuLoadFailed={menuLoadFailed}
      />
    </CustomerShell>
  );
}
