"use server";
import { headers } from "next/headers";
import { managerContext, adminError } from "@/features/menu-admin/server";
import { uuid } from "@/features/menu-admin/validation";
import { validateOrderOrigin } from "@/features/orders/request-protection";
import type { AdminResult } from "@/features/menu-admin/types";

async function protect(id: string) {
  const h = await headers();
  validateOrderOrigin(
    h.get("origin"),
    h.get("x-forwarded-host") ?? h.get("host"),
    h.get("content-length"),
  );
  if (!uuid(id)) throw new Error("Refresh your restaurant workspace.");
  return managerContext(id);
}
export async function setRestaurantOpenAction(
  id: string,
  expected: boolean,
  next: boolean,
): Promise<AdminResult<{ isOpen: boolean }>> {
  try {
    const { client, active } = await protect(id);
    if (typeof expected !== "boolean" || typeof next !== "boolean")
      throw new Error("Choose OPEN or CLOSED.");
    const { data, error } = await client.rpc("set_restaurant_open", {
      target_restaurant: active.id,
      expected_open: expected,
      next_open: next,
    });
    if (error) throw error;
    return { ok: true, data: data as { isOpen: boolean } };
  } catch (e) {
    return { ok: false, message: adminError(e) };
  }
}
export async function rotateTableQRAction(
  id: string,
  table: string,
  version: string,
): Promise<AdminResult> {
  try {
    const { client, active } = await protect(id);
    if (
      !uuid(table) ||
      typeof version !== "string" ||
      !Number.isFinite(Date.parse(version))
    )
      throw new Error("Refresh this table before rotating its code.");
    const { error } = await client.rpc("rotate_table_qr", {
      target_restaurant: active.id,
      target_table: table,
      expected_version: version,
    });
    if (error?.message === "TABLE_OCCUPIED")
      throw new Error(
        "Finish and close this table’s active visit before replacing its QR code.",
      );
    if (error) throw error;
    return { ok: true, data: {} };
  } catch (e) {
    return { ok: false, message: adminError(e) };
  }
}
