import { notFound } from "next/navigation";
import { getRestaurant } from "@/features/menu/queries";

export const dynamic = "force-dynamic";

export default async function CustomerLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ restaurantSlug: string }>;
}) {
  // Resolve before streaming so unknown/unpublished restaurants return HTTP 404.
  if (!(await getRestaurant((await params).restaurantSlug))) notFound();
  return children;
}
