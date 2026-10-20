import { notFound, unstable_rethrow } from "next/navigation";
import { getCustomerContext, getMenu } from "@/features/menu/queries";
import type { CustomerContext, RestaurantMenu } from "@/features/menu/types";
import { normalizeTableToken } from "@/lib/routes";
import { CustomerShell } from "@/features/menu/components/customer-shell";
import { getGuestTablePage } from "@/features/sessions/queries";
import { SessionError } from "@/features/sessions/repository";
import { GuestTableBill } from "@/features/sessions/components/guest-table-bill";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Table bill",
  robots: { index: false, follow: false },
};
export default async function TableBillPage({
  params,
  searchParams,
}: {
  params: Promise<{ restaurantSlug: string }>;
  searchParams: Promise<{ table?: string | string[] }>;
}) {
  const { restaurantSlug } = await params;
  const { table } = await searchParams;
  const normalized = normalizeTableToken(table);
  // Malformed context must not select a different table via an implicit fallback.
  let invalidQR = normalized === "invalid";
  let privatePage: Awaited<ReturnType<typeof getGuestTablePage>> = null;
  if (!invalidQR)
    try {
      privatePage = await getGuestTablePage(
        restaurantSlug,
        normalized ?? undefined,
      );
    } catch (error) {
      unstable_rethrow(error);
      if (error instanceof SessionError && error.code === "TABLE_INVALID")
        invalidQR = true;
      else throw error;
    }
  let menu: RestaurantMenu | null = null,
    context: CustomerContext | null = null;
  try {
    [menu, context] = await Promise.all([
      getMenu(restaurantSlug),
      getCustomerContext(restaurantSlug, table),
    ]);
  } catch (error) {
    unstable_rethrow(error);
    if (!privatePage) throw error;
  }
  if (!menu && !privatePage) notFound();
  const ownedMenu = menu ?? {
    ...privatePage!.history.restaurant,
    currency: privatePage!.history.currency,
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
      <GuestTableBill
        initial={privatePage?.snapshot ?? null}
        invalidQR={invalidQR || context?.table.status === "invalid"}
      />
    </CustomerShell>
  );
}
