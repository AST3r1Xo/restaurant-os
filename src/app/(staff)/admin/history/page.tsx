import Link from "next/link";
import { getDataMode } from "@/lib/env";
import { requireStaffPage } from "@/features/staff/context";
import { parseReportSelection } from "@/features/reports/model";
import { fetchDailyReport } from "@/features/reports/repository";
import { demoDailyReport } from "@/features/reports/demo";
import { DailyDashboard } from "@/features/reports/components/daily-dashboard";
import type { DailyReport, ReportSelection } from "@/features/reports/types";
export const metadata = { title: "Daily history" };
export default async function DailyHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const demo = getDataMode() === "demo";
  const context = demo ? null : await requireStaffPage();
  if (context?.active.role === "staff")
    return (
      <>
        <h1 className="font-display text-3xl">Restaurant history</h1>
        <p className="mt-4 text-sm leading-7 text-muted">
          Daily reports are available to restaurant owners and managers. Use
          Orders and Tables to manage service.
        </p>
      </>
    );
  let selection: ReportSelection;
  let report: DailyReport;
  try {
    selection = parseReportSelection(await searchParams);
    report = context
      ? await fetchDailyReport(context.client, context.active.id, selection)
      : demoDailyReport(selection.day);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "REPORT_INVALID")
      throw error;
    return (
      <div role="alert" className="rounded-2xl border border-line bg-white p-7">
        <h1 className="font-display text-3xl">Choose a reporting day.</h1>
        <p className="mt-4 text-sm text-muted">
          This date or order page is no longer valid for the current restaurant.
          Choose the day again.
        </p>
        <Link
          href="/admin/history"
          className="mt-6 inline-flex min-h-12 items-center rounded-full bg-accent px-5 text-sm text-white"
        >
          View today
        </Link>
      </div>
    );
  }
  return (
    <DailyDashboard
      report={report}
      demo={demo}
      paginated={!!selection.before}
    />
  );
}
