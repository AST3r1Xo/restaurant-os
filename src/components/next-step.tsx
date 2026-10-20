import { ArrowRight, CheckCircle2, TriangleAlert } from "lucide-react";
export function NextStep({
  title,
  children,
  tone = "progress",
}: {
  title: string;
  children: React.ReactNode;
  tone?: "progress" | "success" | "attention";
}) {
  const Icon =
    tone === "attention"
      ? TriangleAlert
      : tone === "success"
        ? CheckCircle2
        : ArrowRight;
  return (
    <div
      className={`flex items-start gap-3 rounded-2xl border-l-4 p-4 sm:p-5 ${tone === "attention" ? "border-attention bg-attention-soft text-attention" : tone === "success" ? "border-accent bg-accent-soft text-accent" : "border-progress bg-progress-soft text-progress"}`}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/80">
        <Icon size={22} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-base font-bold leading-6">{title}</p>
        <div className="mt-1 text-sm leading-6">{children}</div>
      </div>
    </div>
  );
}
