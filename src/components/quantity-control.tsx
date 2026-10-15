"use client";
import { Minus, Plus } from "lucide-react";
export function QuantityControl({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex shrink-0 items-center rounded-full border border-line bg-background">
      <button
        type="button"
        aria-label={`Decrease quantity of ${label}`}
        disabled={disabled || value <= 1}
        onClick={() => onChange(value - 1)}
        className="flex size-11 items-center justify-center rounded-full transition-colors hover:bg-accent-soft disabled:cursor-default disabled:opacity-30"
      >
        <Minus size={16} aria-hidden="true" />
      </button>
      <span
        aria-live="polite"
        aria-label={`Quantity: ${value}`}
        className="min-w-7 text-center text-sm font-semibold tabular-nums"
      >
        {value}
      </span>
      <button
        type="button"
        aria-label={`Increase quantity of ${label}`}
        disabled={disabled || value >= 99}
        onClick={() => onChange(value + 1)}
        className="flex size-11 items-center justify-center rounded-full transition-colors hover:bg-accent-soft disabled:cursor-default disabled:opacity-30"
      >
        <Plus size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
