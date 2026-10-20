import { notFound, redirect } from "next/navigation";
import { getCustomerContext } from "@/features/menu/queries";
import { customerPath } from "@/lib/routes";
import type { Route } from "next";

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
  redirect(
    customerPath(
      context.restaurant.slug,
      "cart",
      context.table.status === "valid" ? context.table.token : undefined,
    ) as Route,
  );
}
