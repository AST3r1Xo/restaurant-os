import type { ButtonHTMLAttributes } from "react";
import clsx from "clsx";

export type ActionTone = "confirm" | "progress" | "attention" | "danger" | "neutral";

const tones: Record<ActionTone, string> = {
  confirm: "border-accent bg-accent text-white hover:bg-accent/90",
  progress: "border-progress bg-progress text-white hover:bg-progress/90",
  attention: "border-attention bg-attention text-white hover:bg-attention/90",
  danger: "border-danger/25 bg-danger-soft text-danger hover:bg-danger/15",
  neutral: "border-line bg-white text-foreground hover:bg-background",
};

export function actionClass(tone: ActionTone = "confirm", className?: string) {
  return clsx(
    "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border px-5 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    tones[tone],
    className,
  );
}

export function ActionButton({ tone = "confirm", className, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ActionTone }) {
  return <button {...props} type={type} className={actionClass(tone, className)} />;
}
