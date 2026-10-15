import { getDataMode } from "@/lib/env";
import { requireStaffPage } from "@/features/staff/context";
import { loadWorkspace } from "@/features/menu-admin/server";
import { RestaurantSettings } from "@/features/menu-admin/settings";
import { demoWorkspace } from "@/features/menu-admin/demo";
export const metadata = { title: "Restaurant settings" };
export default async function SettingsPage() {
  if (getDataMode() === "demo")
    return <RestaurantSettings initial={demoWorkspace()} demo />;
  const { active } = await requireStaffPage();
  if (active.role === "staff")
    return (
      <p className="text-sm text-muted">
        Restaurant settings are available to owners and managers.
      </p>
    );
  return <RestaurantSettings initial={await loadWorkspace(active.id)} />;
}
