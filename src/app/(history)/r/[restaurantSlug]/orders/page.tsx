import { notFound, unstable_rethrow } from "next/navigation";
import { getCustomerContext, getMenu } from "@/features/menu/queries";
import type { CustomerContext, RestaurantMenu } from "@/features/menu/types";
import { CustomerShell } from "@/features/menu/components/customer-shell";
import { getGuestHistory } from "@/features/orders/history/queries";
import { OrdersHistory } from "@/features/orders/history/components/orders-history";
import { validOrderId } from "@/features/orders/payload";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Current orders",
  robots: { index: false, follow: false },
};
export default async function OrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ restaurantSlug: string }>;
  searchParams: Promise<{ table?: string | string[] }>;
}) {
  const { restaurantSlug } = await params;
  const search = await searchParams;
  const scope = "visit";
  const tableToken =
    typeof search.table === "string" && validOrderId(search.table)
      ? search.table
      : undefined;
  // Verify the independent guest identity before reading private history.
  const history =
    scope === "visit" && search.table !== undefined && !tableToken
      ? null
      : await getGuestHistory(restaurantSlug, { scope, tableToken });
  let menu: RestaurantMenu | null = null;
  let context: CustomerContext | null = null;
  let menuFailed = false;
  try {
    [menu, context] = await Promise.all([
      getMenu(restaurantSlug),
      getCustomerContext(restaurantSlug, search.table),
    ]);
  } catch (error) {
    unstable_rethrow(error);
    if (!history) throw error;
    menuFailed = true;
  }
  if (!menu && !history) notFound();
  const ownedMenu: RestaurantMenu = menu ?? {
    ...history!.restaurant,
    currency: history!.currency,
    isAcceptingOrders: false,
    categories: [],
    products: [],
  };
  const shellContext: CustomerContext = context ?? {
    mode: "live",
    restaurant: ownedMenu,
    table: { status: "missing" },
  };
  return (
    <CustomerShell context={shellContext} menuOverride={ownedMenu} visitOnly>
      <OrdersHistory
        initial={history}
        menuAvailable={!!menu}
        menuFailed={menuFailed}
      />
    </CustomerShell>
  );
}
