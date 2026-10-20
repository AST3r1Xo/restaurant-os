import {
  CustomerNavigation,
  CustomerFooter,
} from "@/components/navigation/customer-navigation";
import type { CustomerContext, RestaurantMenu } from "../types";
import { getMenu } from "../queries";
import { notFound } from "next/navigation";
import {
  CartProvider,
  CartNotice,
} from "@/features/cart/components/cart-provider";
import { CartAccess } from "@/features/cart/components/cart-access";
import { getGuestHistory } from "@/features/orders/history/queries";
import { RestaurantClosed } from "./restaurant-closed";
import { CustomerNotifications } from "@/features/notifications/components/customer-notifications";

export async function CustomerShell({
  context,
  menuOverride,
  visitOnly = false,
  children,
}: {
  context: CustomerContext;
  menuOverride?: RestaurantMenu;
  visitOnly?: boolean;
  children: React.ReactNode;
}) {
  if (!context.restaurant.isAcceptingOrders && !visitOnly) {
    const history =
      context.mode === "live"
        ? await getGuestHistory(context.restaurant.slug, {
            scope: "visit",
            tableToken:
              context.table.status === "valid"
                ? context.table.token
                : undefined,
          })
        : null;
    return (
      <RestaurantClosed
        context={context}
        activeVisit={!!history?.visit && history.totals.orderCount > 0}
      />
    );
  }
  const menu = menuOverride ?? (await getMenu(context.restaurant.slug));
  if (!menu) notFound();
  return (
    <CartProvider
      key={`${context.mode}:${menu.id}:${context.table.status === "valid" ? context.table.visitKey : "unbound"}`}
      menu={menu}
      context={context}
    >
      <CustomerNotifications>
        <CustomerNavigation context={context} />
        <main id="main-content" className="mx-auto max-w-6xl px-5 sm:px-8">
          {!context.restaurant.isAcceptingOrders && visitOnly && (
            <p
              role="status"
              className="my-5 rounded-2xl border-l-4 border-attention bg-attention-soft p-4 text-sm font-semibold leading-6 text-attention"
            >
              The restaurant is closed to new orders. Your current visit’s
              orders, updates and table service remain available.
            </p>
          )}
          {context.table.status === "invalid" && (
            <p
              role="status"
              className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"
            >
              This table QR code is unavailable. You can still browse the menu.
              Please scan the current code at your table or ask our team.
            </p>
          )}
          <CartNotice />
          {children}
        </main>
        <CustomerFooter />
        <CartAccess />
      </CustomerNotifications>
    </CartProvider>
  );
}
