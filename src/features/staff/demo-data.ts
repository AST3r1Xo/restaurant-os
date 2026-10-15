import type { KitchenSnapshot, StaffRestaurant } from "./types";
export const demoStaffRestaurant: StaffRestaurant = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "mesa",
  name: "Casa Mesa",
  currency: "EUR",
  timezone: "Europe/Lisbon",
  role: "owner",
};
export function demoKitchen(): KitchenSnapshot {
  const now = new Date();
  return {
    restaurantId: demoStaffRestaurant.id,
    timezone: demoStaffRestaurant.timezone,
    fetchedAt: now.toISOString(),
    metrics: {
      pending: 1,
      preparing: 1,
      ready: 1,
      completedToday: 0,
      receivedToday: 3,
    },
    orders: ["pending", "preparing", "ready"].map((status, i) => ({
      id: `demo-order-${i}`,
      reference: `SAMPLE0${i + 1}`,
      restaurantId: demoStaffRestaurant.id,
      tableLabel: `Table 0${i + 4}`,
      status: status as "pending" | "preparing" | "ready",
      currency: "EUR",
      totalMinor: 3300,
      createdAt: new Date(now.getTime() - (i + 1) * 4 * 60000).toISOString(),
      updatedAt: now.toISOString(),
      notes: "",
      cancelReason: null,
      items: [
        {
          id: `demo-line-${i}`,
          name: "Smoked salmon eggs",
          quantity: 2,
          unitPriceMinor: 1650,
          lineTotalMinor: 3300,
          notes: "",
          options: [
            {
              id: "demo-option",
              groupId: "demo-group",
              groupName: "A little extra",
              name: "Avocado",
              priceAdjustmentMinor: 250,
            },
          ],
        },
      ],
    })),
  };
}
