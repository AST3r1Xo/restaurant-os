import { formatMoney } from "@/lib/format";
import type { SharedBillLine } from "../types";

const labels = {
  pending: "Pending acceptance",
  accepted: "Accepted",
  preparing: "Preparing",
  ready: "Ready",
  served: "Served",
  cancelled: "Cancelled · excluded",
};

export function SharedBillItems({
  lines,
  currency,
}: {
  lines: SharedBillLine[];
  currency: string;
}) {
  return (
    <section
      aria-labelledby="table-items-title"
      className="mt-8 border-t border-line pt-7"
    >
      <h2 id="table-items-title" className="font-display text-2xl">
        Everything ordered at your table
      </h2>
      <p className="mt-2 text-xs leading-6 text-muted">
        Everyone’s dishes for this visit. Customizations and prices are saved
        when each order is placed.
      </p>
      {lines.length === 0 ? (
        <p className="py-6 text-sm text-muted">No dishes ordered this visit.</p>
      ) : (
        <ul
          aria-label="Shared bill items"
          className="mt-3 divide-y divide-line"
        >
          {lines.map((line) => (
            <li
              key={line.key}
              data-bill-line={line.key}
              className={`py-5 ${line.status === "cancelled" ? "text-muted" : ""}`}
            >
              <div className="flex items-start gap-3">
                <span className="inline-flex min-w-9 shrink-0 justify-center rounded-lg bg-accent-soft px-2 py-2 text-xs font-medium tabular-nums text-accent">
                  {line.quantity}×
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                    <h3 className="font-display text-xl leading-tight">
                      {line.name}
                    </h3>
                    <span
                      className={`text-sm font-medium tabular-nums ${line.status === "cancelled" ? "line-through" : "text-accent"}`}
                    >
                      {formatMoney(line.lineTotalMinor, currency)}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    {formatMoney(line.unitPriceMinor, currency)} each
                  </p>
                  {line.options.length > 0 && (
                    <ul className="mt-3 space-y-1.5 text-xs leading-5 text-muted">
                      {line.options.map((option, index) => (
                        <li key={index} className="flex justify-between gap-3">
                          <span>
                            {option.groupName}: {option.name}
                          </span>
                          <span className="shrink-0 tabular-nums">
                            {option.priceAdjustmentMinor
                              ? `+${formatMoney(option.priceAdjustmentMinor, currency)} each`
                              : "Included"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <span
                    className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-[10px] font-medium ${line.status === "cancelled" ? "bg-red-50 text-red-800" : line.status === "pending" ? "bg-amber-50 text-amber-900" : "bg-accent-soft text-accent"}`}
                  >
                    {labels[line.status]}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
