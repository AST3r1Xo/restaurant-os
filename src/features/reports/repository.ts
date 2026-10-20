import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database.ts";
import type { ReportSelection } from "./types.ts";
import { decodeDailyReport } from "./model.ts";

export async function fetchDailyReport(
  client: SupabaseClient<Database>,
  restaurantId: string,
  selection: ReportSelection,
) {
  const { data, error } = await client.rpc("get_daily_restaurant_report", {
    target_restaurant: restaurantId,
    ...(selection.day ? { report_day: selection.day } : {}),
    ...(selection.currency ? { report_currency: selection.currency } : {}),
    ...(selection.before ? { before_order: selection.before } : {}),
  });
  if (error)
    throw new Error(
      error.code === "P0001" && error.message === "REPORT_INVALID"
        ? "REPORT_INVALID"
        : "REPORT_UNAVAILABLE",
    );
  return decodeDailyReport(data, restaurantId);
}
