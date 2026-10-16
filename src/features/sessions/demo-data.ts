import { demoStaffRestaurant } from "@/features/staff/demo-data";
import type { TableWorkspace } from "./types";
import { DEMO_TABLES } from "@/lib/routes";
export function demoTableWorkspace(): TableWorkspace {
  return {
    restaurantId: demoStaffRestaurant.id,
    currency: demoStaffRestaurant.currency,
    timezone: demoStaffRestaurant.timezone,
    fetchedAt: "2026-10-15T12:00:00Z",
    tables: DEMO_TABLES.map((t) => ({
      id: t.token,
      label: t.label,
      isActive: true,
      session: null,
    })),
    history: [],
    nextCursor: null,
    requests: [],
  };
}
