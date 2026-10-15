import { AdminNavigation } from "@/components/navigation/admin-navigation";
import { WorkspaceControls } from "@/features/staff/components/workspace-controls";
import { requireStaffPage } from "@/features/staff/context";
import { demoStaffRestaurant } from "@/features/staff/demo-data";
import { getDataMode } from "@/lib/env";
import { fetchWorkspace } from "@/features/sessions/repository";
import { demoTableWorkspace } from "@/features/sessions/demo-data";
import {
  TableOperationsProvider,
  StaffBillInbox,
} from "@/features/sessions/components/table-operations-provider";
export const metadata = {
  title: "Restaurant workspace",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const demo = getDataMode() === "demo";
  const context = demo ? null : await requireStaffPage();
  const restaurant = context?.active ?? demoStaffRestaurant;
  const tables = context
    ? await fetchWorkspace(context.client, context.active.id)
    : demoTableWorkspace();
  return (
    <TableOperationsProvider
      key={`${demo}:${restaurant.id}`}
      initial={tables}
      demo={demo}
    >
      <AdminNavigation restaurant={restaurant} demo={demo} />
      <div className="lg:ml-60">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-8">
          <span className="text-sm font-medium">
            {restaurant.name}
            <span className="mx-2 text-line">/</span>
            {demo ? "Demo workspace" : `${restaurant.role} workspace`}
          </span>
          {context && (
            <WorkspaceControls
              restaurants={context.memberships}
              activeId={restaurant.id}
            />
          )}
        </header>
        <StaffBillInbox />
        <main
          id="main-content"
          className="mx-auto max-w-[1600px] px-5 py-8 sm:px-8"
        >
          {demo && (
            <p className="mb-7 rounded-xl border border-line bg-white/60 px-4 py-3 text-xs leading-6 text-muted">
              Demo workspace · Sample orders only. Actions are disabled; no
              database mutations or simulated live events.
            </p>
          )}
          {children}
        </main>
      </div>
    </TableOperationsProvider>
  );
}
