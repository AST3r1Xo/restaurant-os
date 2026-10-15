"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { selectRestaurantAction, signOutStaffAction } from "../actions";
import type { StaffRestaurant } from "../types";
export function WorkspaceControls({
  restaurants,
  activeId,
}: {
  restaurants: StaffRestaurant[];
  activeId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const router = useRouter();
  async function select(id: string) {
    setBusy(true);
    setError(undefined);
    try {
      const result = await selectRestaurantAction(id);
      if (result.ok) router.refresh();
      else setError(result.message);
    } catch {
      setError("Could not switch restaurants. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      {restaurants.length > 1 && (
        <>
          <label htmlFor="active-restaurant" className="sr-only">
            Active restaurant
          </label>
          <select
            id="active-restaurant"
            value={activeId}
            disabled={busy}
            onChange={(e) => void select(e.target.value)}
            className="min-h-11 max-w-56 rounded-xl border border-line bg-white px-3 text-sm"
          >
            {restaurants.map((r) => (
              <option value={r.id} key={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </>
      )}
      <form action={signOutStaffAction}>
        <button className="min-h-11 rounded-xl border border-line px-4 text-xs font-medium">
          Sign out
        </button>
      </form>
      {error && (
        <p role="alert" className="w-full text-xs text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
