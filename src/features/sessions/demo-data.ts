import { demoStaffRestaurant } from "@/features/staff/demo-data";
import type { TableWorkspace } from "./types";
export function demoTableWorkspace(): TableWorkspace {
  return {
    restaurantId: demoStaffRestaurant.id,
    currency: demoStaffRestaurant.currency,
    timezone: demoStaffRestaurant.timezone,
    fetchedAt: "2026-10-15T12:00:00Z",
    tables: [
      {
        id: "22222222-2222-4222-8222-222222222221",
        label: "Table 04",
        isActive: true,
        session: null,
      },
    ],
    history: [],
    nextCursor: null,
    requests: [],
  };
}
