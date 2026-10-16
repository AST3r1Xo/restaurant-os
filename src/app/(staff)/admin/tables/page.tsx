import { TablesWorkspace } from "@/features/sessions/components/tables-workspace";
import { getDataMode } from "@/lib/env";
import { requireStaffPage } from "@/features/staff/context";
import { loadTableQRs } from "@/features/restaurant-operations/qr-server";
import { publicQROrigin } from "@/features/restaurant-operations/qr-origin";
import { TableQRManagement } from "@/features/restaurant-operations/qr-management";
import { DEMO_TABLES } from "@/lib/routes";
export const metadata = { title: "Table sessions & bill requests" };
export default async function TablesPage() {
  const demo = getDataMode() === "demo";
  const context = demo ? null : await requireStaffPage();
  if (context?.active.role === "staff") return <TablesWorkspace />;
  const codes = context
    ? await loadTableQRs(context.active.id)
    : {
        restaurant: { id: "demo", name: "Casa Mesa" },
        tables: DEMO_TABLES.map((t) => ({
          id: t.token,
          label: t.label,
          is_active: true,
          updated_at: "demo",
        })),
      };
  let warning: string | undefined;
  try {
    publicQROrigin(process.env.NEXT_PUBLIC_APP_URL);
  } catch (e) {
    warning = (e as Error).message;
  }
  return (
    <>
      <TablesWorkspace />
      <TableQRManagement
        restaurantId={codes.restaurant.id}
        restaurantName={codes.restaurant.name}
        tables={codes.tables.map(({ id, label, is_active, updated_at }) => ({
          id,
          label,
          is_active,
          updated_at,
        }))}
        warning={warning}
        demo={demo}
      />
    </>
  );
}
