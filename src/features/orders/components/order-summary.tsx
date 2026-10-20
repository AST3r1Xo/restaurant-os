import { formatMoney } from "@/lib/format";

export type OrderSummaryLine = {
  key: string;
  name: string;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
  notes?: string;
  options: {
    id: string;
    group: string;
    name: string;
    priceAdjustmentMinor: number;
  }[];
};

export function OrderSummary({
  lines,
  currency,
  totalMinor,
}: {
  lines: OrderSummaryLine[];
  currency: string;
  totalMinor: number;
}) {
  return (
    <div className="rounded-3xl border border-line bg-white px-5 sm:px-7">
      <ul aria-label="Order items" className="divide-y divide-line">
        {lines.map((line) => (
          <li key={line.key} className="py-6">
            <div className="flex items-start gap-3 sm:gap-4">
              <span className="inline-flex min-w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft px-2 py-1.5 text-xs font-medium tabular-nums text-accent">
                {line.quantity}×
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                  <h2 className="font-display text-xl leading-tight sm:text-2xl">
                    {line.name}
                  </h2>
                  <span className="text-sm font-medium tabular-nums">
                    {formatMoney(line.totalMinor, currency)}
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted">
                  {formatMoney(line.unitPriceMinor, currency)} each
                </p>
                {line.options.length > 0 && (
                  <ul className="mt-3 space-y-1.5 text-xs leading-5 text-muted">
                    {line.options.map((option) => (
                      <li
                        key={option.id}
                        className="flex justify-between gap-3"
                      >
                        <span>
                          {option.group}: {option.name}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {option.priceAdjustmentMinor
                            ? `+${formatMoney(option.priceAdjustmentMinor, currency)} / each`
                            : "Included"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {line.notes && (
                  <div className="mt-3 rounded-xl bg-attention-soft px-3 py-2.5 text-xs leading-6 text-attention">
                    <p className="font-semibold">Special request</p>
                    <p className="whitespace-pre-wrap break-words">{line.notes}</p>
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <dl className="border-t border-line py-6">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-sm font-medium">Order total</dt>
          <dd className="font-display text-3xl tabular-nums text-accent">
            {formatMoney(totalMinor, currency)}
          </dd>
        </div>
      </dl>
    </div>
  );
}
