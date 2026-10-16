import "server-only";
import { managerContext } from "@/features/menu-admin/server";
import type { QRTable } from "./qr-artifacts";
export async function loadTableQRs(id: string) {
  const context = await managerContext(id);
  const { data, error } = await context.client.rpc("get_table_qr_codes", {
    target_restaurant: context.active.id,
  });
  if (error)
    throw new Error(
      "Table QR codes could not be loaded. Please reconnect and refresh.",
    );
  return { restaurant: context.active, tables: data as QRTable[] };
}
