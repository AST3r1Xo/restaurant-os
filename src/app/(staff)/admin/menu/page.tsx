import { getDataMode } from "@/lib/env";
import { requireStaffPage } from "@/features/staff/context";
import { loadWorkspace } from "@/features/menu-admin/server";
import { MenuAdmin } from "@/features/menu-admin/workspace";
import { demoWorkspace } from "@/features/menu-admin/demo";
export const metadata = { title: "Menu administration" };
export default async function AdminMenuPage() {
  if (getDataMode() === "demo")
    return <MenuAdmin initial={demoWorkspace()} demo />;
  const { active } = await requireStaffPage();
  if (active.role === "staff")
    return (
      <>
        <h1 className="font-display text-3xl">The menu.</h1>
        <p className="mt-4 max-w-xl text-sm leading-7 text-muted">
          Menu editing is available to restaurant owners and managers. Your
          kitchen and table workspace remains available in the navigation.
        </p>
      </>
    );
  return <MenuAdmin initial={await loadWorkspace(active.id)} />;
}
