"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ArrowUpRight, Box } from "lucide-react";
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
      <div className="relative aspect-square w-28 shrink-0 overflow-hidden rounded-xl bg-accent-soft sm:aspect-[4/3] sm:w-auto sm:rounded-none">
        {product.image && product.image !== failedSource ? (
          <Image
            src={product.image}
            alt={product.imageAlt}
            fill
            sizes="(max-width: 639px) 112px, (max-width: 1023px) 50vw, 360px"
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
          <span className="absolute left-4 top-4 hidden rounded-full bg-background/95 px-3 py-1.5 text-[11px] font-medium text-accent sm:block">
            {product.tags[0]}
          </span>
        )}
        {product.visualization?.demonstration && (
          <span className="absolute bottom-4 right-4 hidden rounded-full border border-accent/15 bg-background/95 px-3 py-2 text-[11px] font-medium text-accent sm:block">
            3D demo
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1 py-1 sm:p-6">
        <div className="flex flex-col items-start gap-1 sm:flex-row sm:justify-between sm:gap-4">
          <h3 className="font-display text-xl leading-tight sm:text-2xl">
            {product.name}
          </h3>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-accent sm:pt-1">
            {formatMoney(product.priceMinor, currency)}
          </span>
        </div>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted sm:mt-3 sm:min-h-12 sm:line-clamp-none sm:text-sm sm:leading-6">
          {product.description}
        </p>
        {product.tags.length > 1 && (
          <div className="mt-5 hidden items-center gap-1.5 border-t border-line pt-4 text-xs text-accent sm:flex">
            <TagIcon size={13} aria-hidden="true" />{" "}
            {product.tags.slice(1).join(" · ")}
          </div>
        )}
        {href && (
          <div className="mt-2 flex items-center justify-between gap-2 text-xs font-medium text-accent sm:mt-4 sm:min-h-11 sm:border-t sm:border-line sm:pt-3">
            {product.visualization ? (
              <span className="inline-flex items-center gap-1.5"><Box size={13} aria-hidden="true" />{product.visualization.demonstration ? "3D demo" : "3D available"}</span>
            ) : <span>Choose dish</span>}
            <ArrowUpRight size={16} aria-hidden="true" />
          </div>
        )}
      </div>
    </>
  );
  return (
    <article className="group overflow-hidden rounded-2xl border border-line bg-white transition-all duration-300 sm:hover:-translate-y-1 sm:hover:shadow-lg motion-reduce:transform-none">
      {href ? (
        <Link
          href={href as Route}
          prefetch={false}
          className="flex items-start gap-3 p-3 sm:block sm:p-0"
          aria-label={`Customize ${product.name}, from ${formatMoney(product.priceMinor, currency)}`}
        >
          {content}
        </Link>
      ) : (
        <div className="flex items-start gap-3 p-3 sm:block sm:p-0">{content}</div>
      )}
    </article>
  );
}
