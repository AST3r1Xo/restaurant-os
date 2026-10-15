import { Utensils } from "lucide-react";
import clsx from "clsx";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5" aria-label="Mesa">
      <span
        className={clsx(
          "flex items-center justify-center rounded-full bg-accent text-background",
          compact ? "size-8" : "size-9",
        )}
      >
        <Utensils
          size={compact ? 14 : 16}
          strokeWidth={1.5}
          aria-hidden="true"
        />
      </span>
      <span
        className={clsx(
          "font-display tracking-tight",
          compact ? "text-2xl" : "text-3xl",
        )}
      >
        mesa<span className="text-accent">.</span>
      </span>
    </span>
  );
}
