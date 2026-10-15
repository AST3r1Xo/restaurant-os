import { getDataMode } from "@/lib/env";
import { requireStaffPage } from "@/features/staff/context";
import { fetchKitchen } from "@/features/staff/repository";
import { demoKitchen, demoStaffRestaurant } from "@/features/staff/demo-data";
import { KitchenDashboard } from "@/features/staff/components/kitchen-dashboard";
export default async function DashboardPage() {
  if (getDataMode() === "demo")
    return (
      <KitchenDashboard
        initial={demoKitchen()}
        restaurant={demoStaffRestaurant}
        demo
        overview
      />
    );
  const { client, active } = await requireStaffPage();
  return (
    <KitchenDashboard
      key={active.id}
      initial={await fetchKitchen(client, active.id)}
      restaurant={active}
      overview
    />
  );
}
