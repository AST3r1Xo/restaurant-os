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

export async function CustomerShell({
  context,
  menuOverride,
  children,
}: {
  context: CustomerContext;
  menuOverride?: RestaurantMenu;
  children: React.ReactNode;
}) {
  const menu = menuOverride ?? (await getMenu(context.restaurant.slug));
  if (!menu) notFound();
  return (
    <CartProvider
      key={`${context.mode}:${menu.id}:${context.table.status === "valid" ? context.table.visitKey : "unbound"}`}
      menu={menu}
      context={context}
    >
      <CustomerNavigation context={context} />
      <main id="main-content" className="mx-auto max-w-6xl px-5 sm:px-8">
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
    </CartProvider>
  );
}
