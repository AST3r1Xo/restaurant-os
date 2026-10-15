"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ArrowUpRight } from "lucide-react";
import Image from "next/image";
import { Leaf, Sparkles, Utensils } from "lucide-react";
import type { MenuProduct } from "../types";
import { formatMoney } from "@/lib/format";

export function ProductCard({
  product,
  currency,
  href,
}: {
  product: MenuProduct;
  currency: string;
  href?: string;
}) {
  const [failedSource, setFailedSource] = useState<string>();
  const TagIcon = ["Vegetarian", "Plant based"].includes(product.tags[1])
    ? Leaf
    : Sparkles;
  const content = (
    <>
      <div className="relative aspect-[4/3] overflow-hidden bg-accent-soft">
        {product.image && product.image !== failedSource ? (
          <Image
            src={product.image}
            alt={product.imageAlt}
            fill
            sizes="(max-width: 639px) 100vw, (max-width: 1023px) 50vw, 360px"
            className="object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transform-none"
            onError={() => setFailedSource(product.image)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-accent/50">
            <Utensils size={36} strokeWidth={1} aria-hidden="true" />
            <span className="sr-only">
              Image unavailable for {product.name}
            </span>
          </div>
        )}
        {product.tags[0] && (
          <span className="absolute left-4 top-4 rounded-full bg-background/95 px-3 py-1.5 text-[11px] font-medium text-accent">
            {product.tags[0]}
          </span>
        )}
      </div>
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <h3 className="font-display text-2xl leading-tight">
            {product.name}
          </h3>
          <span className="shrink-0 pt-1 text-sm font-semibold tabular-nums">
            {formatMoney(product.priceMinor, currency)}
          </span>
        </div>
        <p className="mt-3 min-h-12 text-sm leading-6 text-muted">
          {product.description}
        </p>
        {product.tags.length > 1 && (
          <div className="mt-5 flex items-center gap-1.5 border-t border-line pt-4 text-xs text-accent">
            <TagIcon size={13} aria-hidden="true" />{" "}
            {product.tags.slice(1).join(" · ")}
          </div>
        )}
        {href && (
          <div className="mt-4 flex min-h-11 items-center justify-between border-t border-line pt-3 text-xs font-medium text-accent">
            <span>Make it yours</span>
            <ArrowUpRight size={16} aria-hidden="true" />
          </div>
        )}
      </div>
    </>
  );
  return (
    <article className="group overflow-hidden rounded-2xl border border-line bg-white transition-all duration-300 hover:-translate-y-1 hover:shadow-lg motion-reduce:transform-none">
      {href ? (
        <Link
          href={href as Route}
          prefetch={false}
          className="block"
          aria-label={`Customize ${product.name}, from ${formatMoney(product.priceMinor, currency)}`}
        >
          {content}
        </Link>
      ) : (
        content
      )}
    </article>
  );
}
