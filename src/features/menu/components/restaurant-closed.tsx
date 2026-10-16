import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { Clock3, ArrowRight } from "lucide-react";
import { customerPath } from "@/lib/routes";
import type { CustomerContext } from "../types";

export function RestaurantClosed({
  context,
  activeVisit = false,
}: {
  context: CustomerContext;
  activeVisit?: boolean;
}) {
  const r = context.restaurant;
  const token =
    context.table.status === "valid" ? context.table.token : undefined;
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-dvh max-w-5xl items-center px-5 py-10 sm:px-8"
    >
      <section
        className="grid w-full overflow-hidden rounded-[2rem] border border-line bg-white md:grid-cols-2"
        aria-labelledby="closed-title"
      >
        <div className="relative min-h-48 bg-accent md:min-h-[560px]">
          {r.coverImage && (
            <Image
              src={r.coverImage}
              alt={`${r.name} restaurant`}
              fill
              priority
              sizes="(max-width: 767px) 100vw, 500px"
              className="object-cover opacity-65"
            />
          )}
          <div className="absolute inset-0 bg-linear-to-t from-black/60 to-transparent" />
          <p className="absolute bottom-7 left-7 right-7 font-display text-4xl text-white">
            {r.name}
          </p>
        </div>
        <div className="flex flex-col justify-center p-7 sm:p-10">
          {r.logoImage && (
            <Image
              src={r.logoImage}
              alt={`${r.name} logo`}
              width={72}
              height={72}
              className="mb-7 size-18 object-contain"
            />
          )}
          <span className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.18em] text-accent">
            <Clock3 size={15} aria-hidden="true" /> Currently closed
          </span>
          <h1
            id="closed-title"
            className="mt-5 font-display text-4xl leading-tight sm:text-5xl"
          >
            We look forward
            <br />
            to welcoming you.
          </h1>
          <p className="mt-5 text-sm leading-7 text-muted">
            {r.name} is currently closed. New visits and orders are paused.
            Please return when we’re open, or speak with our team.
          </p>
          {r.openingHours && (
            <div className="mt-6 rounded-2xl bg-accent-soft p-5">
              <h2 className="text-xs font-semibold text-accent">
                Opening hours
              </h2>
              <p className="mt-2 whitespace-pre-line text-sm leading-7 text-muted">
                {r.openingHours}
              </p>
            </div>
          )}
          <a
            href={customerPath(r.slug, "menu", token)}
            className="mt-6 inline-flex min-h-12 items-center justify-center rounded-full bg-accent px-6 text-sm font-medium text-white"
          >
            Check opening status
          </a>
          {activeVisit && (
            <div className="mt-7 space-y-3">
              <p className="text-xs leading-6 text-muted">
                Already dining with us? Your current orders and table service
                remain available.
              </p>
              {(
                [
                  ["orders", "Current orders"],
                  ["bill", "Table bill"],
                ] as const
              ).map(([page, label]) => (
                <Link
                  key={page}
                  prefetch={false}
                  href={customerPath(r.slug, page, token) as Route}
                  className="flex min-h-12 items-center justify-between rounded-xl border border-line px-4 text-sm font-medium text-accent"
                >
                  {label}
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              ))}
            </div>
          )}
          <p className="mt-8 text-[11px] leading-5 text-muted">
            Thoughtfully prepared. Worth coming back for.
          </p>
        </div>
      </section>
    </main>
  );
}
