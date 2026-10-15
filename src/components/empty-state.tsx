import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { Route } from "next";

export function EmptyState({
  icon: Icon,
  eyebrow,
  title,
  description,
  href,
  action,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  action: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-3xl border border-line bg-white/60 px-6 py-16 text-center sm:py-24">
      <span className="flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Icon size={24} strokeWidth={1.5} aria-hidden="true" />
      </span>
      <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-accent">
        {eyebrow}
      </p>
      <h1 className="mt-3 font-display text-3xl sm:text-4xl">{title}</h1>
      <p className="mt-4 max-w-sm text-sm leading-7 text-muted">
        {description}
      </p>
      <Link
        href={href as Route}
        className="mt-8 inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-accent/90"
      >
        {action}
      </Link>
    </div>
  );
}
